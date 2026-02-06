package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os/exec"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
)

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

type saveCredentialsRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type fetchDataResult struct {
	Success    bool                  `json:"success"`
	Portfolios []SnowballPortfolio   `json:"portfolios"`
	Error      string                `json:"error"`
}

type SnowballPortfolio struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Currency    string         `json:"currency"`
	IsComposite bool           `json:"isComposite"`
	Stats       *SnowballStats `json:"stats,omitempty"`
}

type SnowballStats struct {
	CurrentCost   float64 `json:"currentCost"`
	IncomePercent float64 `json:"incomePercent"`
}

func (s *server) fetchPortfoliosViaBrowser(email, password string) ([]SnowballPortfolio, error) {
	cmd := exec.Command("node", "/app/browser/fetch-data.js", email, password)
	output, err := cmd.Output()
	
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			log.Printf("Browser script stderr: %s", string(exitErr.Stderr))
		}
		return nil, err
	}

	var result fetchDataResult
	if err := json.Unmarshal(output, &result); err != nil {
		return nil, err
	}

	if !result.Success {
		return nil, &BrowserError{Message: result.Error}
	}

	return result.Portfolios, nil
}

type BrowserError struct {
	Message string
}

func (e *BrowserError) Error() string {
	return e.Message
}

func (s *server) handleSaveCredentials(w http.ResponseWriter, r *http.Request) {
	var req saveCredentialsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if req.Email == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "email and password are required")
		return
	}

	creds, err := s.db.SaveCredentials(r.Context(), req.Email, req.Password)
	if err != nil {
		log.Printf("Failed to save credentials: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to save credentials")
		return
	}

	go s.syncPortfolios(creds)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "ok",
		"message": "credentials saved, syncing portfolios...",
	})
}

func (s *server) handleGetCredentials(w http.ResponseWriter, r *http.Request) {
	creds, err := s.db.GetCredentials(r.Context())
	if err != nil {
		log.Printf("Failed to get credentials: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to get credentials")
		return
	}

	if creds == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"connected": false,
		})
		return
	}

	response := map[string]interface{}{
		"connected": true,
		"updatedAt": creds.UpdatedAt,
	}
	if creds.Email != nil {
		response["email"] = *creds.Email
	}

	writeJSON(w, http.StatusOK, response)
}

func (s *server) handleDeleteCredentials(w http.ResponseWriter, r *http.Request) {
	creds, err := s.db.GetCredentials(r.Context())
	if err != nil || creds == nil {
		writeError(w, http.StatusNotFound, "no credentials found")
		return
	}

	if err := s.db.DeleteCredentials(r.Context(), creds.ID); err != nil {
		log.Printf("Failed to delete credentials: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to delete credentials")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *server) handleListPortfolios(w http.ResponseWriter, r *http.Request) {
	creds, err := s.db.GetCredentials(r.Context())
	if err != nil {
		log.Printf("Failed to get credentials: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to get credentials")
		return
	}

	if creds == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"portfolios": []interface{}{},
			"connected":  false,
		})
		return
	}

	portfolios, err := s.db.ListPortfolios(r.Context(), creds.ID)
	if err != nil {
		log.Printf("Failed to list portfolios: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to list portfolios")
		return
	}

	if portfolios == nil {
		portfolios = []Portfolio{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"portfolios": portfolios,
		"connected":  true,
	})
}

type updatePortfolioRequest struct {
	Excluded *bool `json:"excluded"`
}

func (s *server) handleUpdatePortfolio(w http.ResponseWriter, r *http.Request) {
	idParam := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idParam, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid portfolio id")
		return
	}

	var req updatePortfolioRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if req.Excluded != nil {
		if err := s.db.UpdatePortfolioExcluded(r.Context(), id, *req.Excluded); err != nil {
			log.Printf("Failed to update portfolio: %v", err)
			writeError(w, http.StatusInternalServerError, "failed to update portfolio")
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *server) handleSync(w http.ResponseWriter, r *http.Request) {
	creds, err := s.db.GetCredentials(r.Context())
	if err != nil || creds == nil {
		writeError(w, http.StatusNotFound, "no credentials found")
		return
	}

	go s.syncPortfolios(creds)

	writeJSON(w, http.StatusAccepted, map[string]string{
		"status":  "syncing",
		"message": "sync started in background",
	})
}

func (s *server) syncPortfolios(creds *Credentials) {
	ctx := context.Background()
	log.Printf("Starting Snowball sync")

	if creds.Email == nil || creds.Password == nil {
		log.Printf("No credentials available for sync")
		return
	}

	portfolios, err := s.fetchPortfoliosViaBrowser(*creds.Email, *creds.Password)
	if err != nil {
		log.Printf("Failed to fetch portfolios: %v", err)
		return
	}

	for _, p := range portfolios {
		var currency *string
		if p.Currency != "" {
			currency = &p.Currency
		}

		var currentCost, incomePercent float64
		if p.Stats != nil {
			currentCost = p.Stats.CurrentCost
			incomePercent = p.Stats.IncomePercent
		}

		dbPortfolio, err := s.db.UpsertPortfolio(ctx, creds.ID, p.ID, p.Name, currency, p.IsComposite, currentCost, incomePercent)
		if err != nil {
			log.Printf("Failed to upsert portfolio %s: %v", p.Name, err)
			continue
		}

		if err := s.db.InsertBalanceHistory(ctx, dbPortfolio.ID, currentCost); err != nil {
			log.Printf("Failed to insert balance history for %s: %v", p.Name, err)
		}
	}

	log.Printf("Sync completed: %d portfolios", len(portfolios))
}

func (s *server) handleGetPortfolioHistory(w http.ResponseWriter, r *http.Request) {
	idParam := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idParam, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid portfolio id")
		return
	}

	portfolio, err := s.db.GetPortfolioByID(r.Context(), id)
	if err != nil {
		log.Printf("Failed to get portfolio: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to get portfolio")
		return
	}
	if portfolio == nil {
		writeError(w, http.StatusNotFound, "portfolio not found")
		return
	}

	var from, to *time.Time
	if fromStr := r.URL.Query().Get("from"); fromStr != "" {
		if parsed, err := time.Parse(time.RFC3339, fromStr); err == nil {
			from = &parsed
		}
	}
	if toStr := r.URL.Query().Get("to"); toStr != "" {
		if parsed, err := time.Parse(time.RFC3339, toStr); err == nil {
			to = &parsed
		}
	}

	points, err := s.db.GetPortfolioHistory(r.Context(), id, from, to)
	if err != nil {
		log.Printf("Failed to get portfolio history: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to get history")
		return
	}

	if points == nil {
		points = []BalanceHistoryPoint{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"portfolioId": id,
		"name":        portfolio.Name,
		"currency":    portfolio.Currency,
		"points":      points,
	})
}

func (s *server) handleGetTotalBalance(w http.ResponseWriter, r *http.Request) {
	creds, err := s.db.GetCredentials(r.Context())
	if err != nil || creds == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"totalUsd":  0,
			"connected": false,
		})
		return
	}

	total, err := s.db.GetTotalBalanceUSD(r.Context(), creds.ID)
	if err != nil {
		log.Printf("Failed to get total balance: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to get balance")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"totalUsd":  total,
		"connected": true,
	})
}

func decodeJSON(r *http.Request, out interface{}) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	return decoder.Decode(out)
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

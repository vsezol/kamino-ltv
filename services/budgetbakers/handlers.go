package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
)

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

type saveCredentialsRequest struct {
	Email      string `json:"email"`
	UserID     string `json:"userId"`
	CouchURL   string `json:"couchUrl"`
	CouchDB    string `json:"couchDb"`
	CouchLogin string `json:"couchLogin"`
	CouchToken string `json:"couchToken"`
}

func (s *server) handleSaveCredentials(w http.ResponseWriter, r *http.Request) {
	var req saveCredentialsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if req.Email == "" || req.CouchURL == "" || req.CouchDB == "" || req.CouchLogin == "" || req.CouchToken == "" {
		writeError(w, http.StatusBadRequest, "all fields are required")
		return
	}

	creds, err := s.db.SaveCredentials(r.Context(), req.Email, req.UserID, req.CouchURL, req.CouchDB, req.CouchLogin, req.CouchToken)
	if err != nil {
		log.Printf("Failed to save credentials: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to save credentials")
		return
	}

	go s.syncAccounts(creds)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "ok",
		"email":   creds.Email,
		"message": "credentials saved, syncing accounts...",
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

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"connected": true,
		"email":     creds.Email,
		"userId":    creds.UserID,
		"updatedAt": creds.UpdatedAt,
	})
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

func (s *server) handleListAccounts(w http.ResponseWriter, r *http.Request) {
	creds, err := s.db.GetCredentials(r.Context())
	if err != nil {
		log.Printf("Failed to get credentials: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to get credentials")
		return
	}

	if creds == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"accounts":  []interface{}{},
			"connected": false,
		})
		return
	}

	accounts, err := s.db.ListAccounts(r.Context(), creds.ID)
	if err != nil {
		log.Printf("Failed to list accounts: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to list accounts")
		return
	}

	if accounts == nil {
		accounts = []Account{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"accounts":  accounts,
		"connected": true,
	})
}

type updateAccountRequest struct {
	Excluded *bool `json:"excluded"`
}

func (s *server) handleUpdateAccount(w http.ResponseWriter, r *http.Request) {
	idParam := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idParam, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid account id")
		return
	}

	var req updateAccountRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if req.Excluded != nil {
		if err := s.db.UpdateAccountExcluded(r.Context(), id, *req.Excluded); err != nil {
			log.Printf("Failed to update account: %v", err)
			writeError(w, http.StatusInternalServerError, "failed to update account")
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

	go s.syncAccounts(creds)

	writeJSON(w, http.StatusAccepted, map[string]string{
		"status":  "syncing",
		"message": "sync started in background",
	})
}

func convertToUSD(balanceCents int64, currencyCode string) float64 {
	amount := float64(balanceCents) / 100
	switch currencyCode {
	case "USD":
		return amount
	case "EUR":
		return amount * 1.08
	case "RUB":
		return amount / 95
	case "GEL":
		return amount / 2.7
	case "KZT":
		return amount / 450
	case "TRY":
		return amount / 35
	default:
		return amount
	}
}

func (s *server) syncAccounts(creds *Credentials) {
	ctx := context.Background()
	log.Printf("Starting sync for %s", creds.Email)

	client := NewCouchDBClient(creds.CouchURL, creds.CouchDB, creds.CouchLogin, creds.CouchToken)

	data, err := client.FetchBBData(ctx)
	if err != nil {
		log.Printf("Failed to fetch data: %v", err)
		return
	}

	balances := data.CalculateAccountBalances()

	for _, acc := range data.Accounts {
		balance := balances[acc.ID]
		var currCode *string
		if acc.CurrencyCode != "" {
			currCode = &acc.CurrencyCode
		}

		dbAcc, err := s.db.UpsertAccount(ctx, creds.ID, acc.ID, acc.Name, currCode, balance, acc.ExcludeFromStats, acc.Archived)
		if err != nil {
			log.Printf("Failed to upsert account %s: %v", acc.Name, err)
			continue
		}

		balanceUSD := convertToUSD(balance, acc.CurrencyCode)
		if err := s.db.InsertBalanceHistory(ctx, dbAcc.ID, balance, &balanceUSD); err != nil {
			log.Printf("Failed to insert balance history for %s: %v", acc.Name, err)
		}
	}

	log.Printf("Sync completed for %s: %d accounts", creds.Email, len(data.Accounts))
}

func (s *server) handleGetAccountHistory(w http.ResponseWriter, r *http.Request) {
	idParam := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idParam, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid account id")
		return
	}

	acc, err := s.db.GetAccountByID(r.Context(), id)
	if err != nil {
		log.Printf("Failed to get account: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to get account")
		return
	}
	if acc == nil {
		writeError(w, http.StatusNotFound, "account not found")
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

	points, err := s.db.GetAccountHistory(r.Context(), id, from, to)
	if err != nil {
		log.Printf("Failed to get account history: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to get history")
		return
	}

	if points == nil {
		points = []BalanceHistoryPoint{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"accountId": id,
		"name":      acc.Name,
		"currency":  acc.CurrencyCode,
		"points":    points,
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

func (s *server) handleGetScript(w http.ResponseWriter, r *http.Request) {
	script := `(async () => {
  try {
    const sessionRes = await fetch('/api/auth/session');
    const session = await sessionRes.json();
    
    if (!session?.user?.bbJwtToken) {
      console.error('❌ Not logged in! Please login first.');
      return;
    }
    
    const userRes = await fetch('/api/trpc/user.getUser?batch=1&input=' + encodeURIComponent(JSON.stringify({"0":{"json":null,"meta":{"values":["undefined"]}}})));
    const userData = await userRes.json();
    
    const user = userData?.[0]?.result?.data?.json;
    if (!user?.replication) {
      console.error('❌ Could not get CouchDB credentials');
      return;
    }
    
    const credentials = {
      userId: user.userId,
      email: user.email,
      couchUrl: user.replication.url,
      couchDb: user.replication.dbName,
      couchLogin: user.replication.login,
      couchToken: user.replication.token,
    };
    
    console.log('✅ BudgetBakers Credentials:');
    console.log(JSON.stringify(credentials, null, 2));
    
    await navigator.clipboard.writeText(JSON.stringify(credentials));
    console.log('\\n📋 Copied to clipboard!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
})();`

	w.Header().Set("Content-Type", "text/plain")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(script))
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

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type priceIngest struct {
	WalletID   int64
	PriceUSD   float64
	RecordedAt time.Time
}

type sseClient struct {
	id     string
	events chan []byte
}

type server struct {
	env        Env
	db         *DB
	ingestCh   chan priceIngest
	sseClients map[string]*sseClient
	sseMutex   sync.RWMutex
}

func main() {
	env := loadEnv()
	ctx := context.Background()

	db, err := initDB(ctx, env)
	if err != nil {
		log.Fatalf("Failed to init DB: %v", err)
	}
	defer db.Close()

	s := &server{
		env:        env,
		db:         db,
		ingestCh:   make(chan priceIngest, env.IngestBufferSize),
		sseClients: make(map[string]*sseClient),
	}
	s.startWorkers()

	router := chi.NewRouter()
	router.Use(s.corsMiddleware)
	router.Use(s.loggingMiddleware)

	router.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	router.Route("/api", func(r chi.Router) {
		r.Get("/wallets", s.handleListWallets)
		r.Post("/wallets", s.handleCreateWallet)
		r.Post("/prices", s.handleIngestPrice)
		r.Get("/wallets/{id}/history", s.handleWalletHistory)
		r.Get("/history", s.handleAggregateHistory)
		r.Get("/events", s.handleSSE)
	})

	addr := ":" + env.Port
	log.Printf("Stats service listening on %s", addr)
	if err := http.ListenAndServe(addr, router); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}

func (s *server) startWorkers() {
	for i := 0; i < s.env.IngestWorkers; i++ {
		go func(workerID int) {
			for item := range s.ingestCh {
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				if err := s.db.InsertPrice(ctx, item.WalletID, item.PriceUSD, item.RecordedAt); err != nil {
					log.Printf("Worker %d failed to insert price: %v", workerID, err)
				}
				cancel()
			}
		}(i + 1)
	}
}

func (s *server) handleListWallets(w http.ResponseWriter, r *http.Request) {
	wallets, err := s.db.ListWallets(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list wallets")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"wallets": wallets})
}

type createWalletRequest struct {
	Address    string  `json:"address"`
	AssetClass string  `json:"assetClass"`
	Label      *string `json:"label"`
}

func (s *server) handleCreateWallet(w http.ResponseWriter, r *http.Request) {
	var req createWalletRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	address := strings.TrimSpace(req.Address)
	if address == "" {
		writeError(w, http.StatusBadRequest, "address is required")
		return
	}

	wallet, err := s.db.FindOrCreateWallet(r.Context(), address, strings.TrimSpace(req.AssetClass), req.Label)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save wallet")
		return
	}
	writeJSON(w, http.StatusOK, wallet)
}

type ingestPriceRequest struct {
	WalletID     *int64  `json:"walletId"`
	WalletAddress *string `json:"walletAddress"`
	PriceUSD     *float64 `json:"priceUsd"`
	RecordedAt   *string `json:"recordedAt"`
}

func (s *server) handleIngestPrice(w http.ResponseWriter, r *http.Request) {
	var req ingestPriceRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if req.PriceUSD == nil {
		writeError(w, http.StatusBadRequest, "priceUsd is required")
		return
	}

	var recordedAt time.Time
	if req.RecordedAt != nil && *req.RecordedAt != "" {
		parsed, err := time.Parse(time.RFC3339, *req.RecordedAt)
		if err != nil {
			writeError(w, http.StatusBadRequest, "recordedAt must be RFC3339")
			return
		}
		recordedAt = parsed
	} else {
		recordedAt = time.Now().UTC()
	}

	var walletID int64
	if req.WalletID != nil {
		walletID = *req.WalletID
	} else if req.WalletAddress != nil && strings.TrimSpace(*req.WalletAddress) != "" {
		address := strings.TrimSpace(*req.WalletAddress)
		wallet, err := s.db.FindOrCreateWallet(r.Context(), address, "crypto", nil)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to resolve wallet")
			return
		}
		walletID = wallet.ID
	} else {
		writeError(w, http.StatusBadRequest, "walletId or walletAddress is required")
		return
	}

	item := priceIngest{
		WalletID:   walletID,
		PriceUSD:   *req.PriceUSD,
		RecordedAt: recordedAt,
	}

	select {
	case s.ingestCh <- item:
		// Broadcast to SSE clients
		s.broadcastPriceUpdate(walletID, *req.PriceUSD, recordedAt)
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "queued"})
	default:
		writeError(w, http.StatusTooManyRequests, "ingest queue full")
	}
}

func (s *server) handleWalletHistory(w http.ResponseWriter, r *http.Request) {
	idParam := chi.URLParam(r, "id")
	walletID, err := strconv.ParseInt(idParam, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid wallet id")
		return
	}

	from, to, err := parseRangeParams(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	points, err := s.db.WalletHistory(r.Context(), walletID, from, to)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load history")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"walletId": walletID,
		"points":   points,
	})
}

func (s *server) handleAggregateHistory(w http.ResponseWriter, r *http.Request) {
	from, to, err := parseRangeParams(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	points, err := s.db.AggregateHistory(r.Context(), from, to)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load history")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"points": points,
	})
}

func parseRangeParams(r *http.Request) (*time.Time, *time.Time, error) {
	var from *time.Time
	var to *time.Time

	fromParam := r.URL.Query().Get("from")
	if fromParam != "" {
		parsed, err := time.Parse(time.RFC3339, fromParam)
		if err != nil {
			return nil, nil, errors.New("from must be RFC3339")
		}
		from = &parsed
	}

	toParam := r.URL.Query().Get("to")
	if toParam != "" {
		parsed, err := time.Parse(time.RFC3339, toParam)
		if err != nil {
			return nil, nil, errors.New("to must be RFC3339")
		}
		to = &parsed
	}

	return from, to, nil
}

func decodeJSON(r *http.Request, out interface{}) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// SSE client management
func (s *server) addSSEClient(client *sseClient) {
	s.sseMutex.Lock()
	defer s.sseMutex.Unlock()
	s.sseClients[client.id] = client
	log.Printf("SSE client connected: %s (total: %d)", client.id, len(s.sseClients))
}

func (s *server) removeSSEClient(id string) {
	s.sseMutex.Lock()
	defer s.sseMutex.Unlock()
	if client, ok := s.sseClients[id]; ok {
		close(client.events)
		delete(s.sseClients, id)
		log.Printf("SSE client disconnected: %s (total: %d)", id, len(s.sseClients))
	}
}

type priceUpdateEvent struct {
	WalletID   int64   `json:"walletId"`
	PriceUSD   float64 `json:"priceUsd"`
	RecordedAt string  `json:"recordedAt"`
}

func (s *server) broadcastPriceUpdate(walletID int64, priceUSD float64, recordedAt time.Time) {
	event := priceUpdateEvent{
		WalletID:   walletID,
		PriceUSD:   priceUSD,
		RecordedAt: recordedAt.Format(time.RFC3339),
	}
	data, err := json.Marshal(event)
	if err != nil {
		log.Printf("Failed to marshal SSE event: %v", err)
		return
	}

	message := fmt.Sprintf("event: price_update\ndata: %s\n\n", string(data))

	s.sseMutex.RLock()
	defer s.sseMutex.RUnlock()

	for _, client := range s.sseClients {
		select {
		case client.events <- []byte(message):
		default:
			// Client buffer full, skip
		}
	}
}

func (s *server) handleSSE(w http.ResponseWriter, r *http.Request) {
	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Create client
	client := &sseClient{
		id:     uuid.New().String(),
		events: make(chan []byte, 100),
	}
	s.addSSEClient(client)

	// Ensure cleanup on disconnect
	defer s.removeSSEClient(client.id)

	// Get flusher
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}

	// Send initial connection event
	fmt.Fprintf(w, "event: connected\ndata: {\"clientId\":\"%s\"}\n\n", client.id)
	flusher.Flush()

	// Heartbeat ticker
	heartbeat := time.NewTicker(time.Duration(s.env.SSEHeartbeatSeconds) * time.Second)
	defer heartbeat.Stop()

	// Event loop
	for {
		select {
		case <-r.Context().Done():
			return
		case msg := <-client.events:
			_, err := w.Write(msg)
			if err != nil {
				return
			}
			flusher.Flush()
		case <-heartbeat.C:
			fmt.Fprintf(w, ": heartbeat\n\n")
			flusher.Flush()
		}
	}
}

func (s *server) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}

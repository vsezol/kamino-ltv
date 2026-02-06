package main

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

type server struct {
	env Env
	db  *DB
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
		env: env,
		db:  db,
	}

	go s.startAutoSync()

	router := chi.NewRouter()
	router.Use(s.corsMiddleware)
	router.Use(s.loggingMiddleware)

	router.Get("/health", s.handleHealth)

	router.Route("/api", func(r chi.Router) {
		r.Get("/credentials", s.handleGetCredentials)
		r.Post("/credentials", s.handleSaveCredentials)
		r.Delete("/credentials", s.handleDeleteCredentials)
		r.Get("/portfolios", s.handleListPortfolios)
		r.Put("/portfolios/{id}", s.handleUpdatePortfolio)
		r.Get("/portfolios/{id}/history", s.handleGetPortfolioHistory)
		r.Post("/sync", s.handleSync)
		r.Get("/balance", s.handleGetTotalBalance)
	})

	addr := ":" + env.Port
	log.Printf("Snowball service listening on %s", addr)
	if err := http.ListenAndServe(addr, router); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}

func (s *server) startAutoSync() {
	ticker := time.NewTicker(2 * time.Minute)
	defer ticker.Stop()

	s.runSync()

	for range ticker.C {
		s.runSync()
	}
}

func (s *server) runSync() {
	ctx := context.Background()
	creds, err := s.db.GetCredentials(ctx)
	if err != nil {
		log.Printf("Auto-sync: failed to get credentials: %v", err)
		return
	}
	if creds == nil {
		return
	}
	s.syncPortfolios(creds)
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
		log.Printf("%s %s", r.Method, r.URL.Path)
		next.ServeHTTP(w, r)
	})
}

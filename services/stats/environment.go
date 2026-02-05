package main

import (
	"log"
	"os"
	"strconv"
)

type Env struct {
	Port                string
	DatabaseURL         string
	NodeEnv             string
	MigrationsPath      string
	IngestBufferSize    int
	IngestWorkers       int
	SSEHeartbeatSeconds int
}

func loadEnv() Env {
	required := []string{"PORT", "DATABASE_URL"}
	for _, key := range required {
		if os.Getenv(key) == "" {
			log.Fatalf("%s is not set", key)
		}
	}

	return Env{
		Port:                os.Getenv("PORT"),
		DatabaseURL:         os.Getenv("DATABASE_URL"),
		NodeEnv:             getEnvDefault("NODE_ENV", "development"),
		MigrationsPath:      getEnvDefault("MIGRATIONS_PATH", "migrations"),
		IngestBufferSize:    getEnvDefaultInt("STATS_INGEST_BUFFER", 1000),
		IngestWorkers:       getEnvDefaultInt("STATS_INGEST_WORKERS", 2),
		SSEHeartbeatSeconds: getEnvDefaultInt("SSE_HEARTBEAT_SECONDS", 15),
	}
}

func getEnvDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getEnvDefaultInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		log.Fatalf("%s must be an integer", key)
	}
	return parsed
}

package main

import (
	"os"
)

type Env struct {
	Port           string
	DatabaseURL    string
	MigrationsPath string
}

func loadEnv() Env {
	return Env{
		Port:           getEnv("PORT", "3006"),
		DatabaseURL:    getEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/snowball_db"),
		MigrationsPath: getEnv("MIGRATIONS_PATH", "./migrations"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

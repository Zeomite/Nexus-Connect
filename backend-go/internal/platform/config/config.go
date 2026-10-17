package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port int

	PostgresHost     string
	PostgresPort     int
	PostgresDB       string
	PostgresUser     string
	PostgresPassword string
	PostgresPoolMax  int
	PostgresSSLMode  string

	RedisHost     string
	RedisPort     int
	RedisPassword string
	RedisDB       int

	JWTAccessSecret  string
	JWTRefreshSecret string
	JWTAccessExpiry  time.Duration
	JWTRefreshExpiry time.Duration

	CORSOrigins []string
	NodeEnv     string

	SMTPHost     string
	SMTPPort     int
	SMTPUser     string
	SMTPPassword string
	EmailFrom    string

	StorageBucket string
	StorageRegion string
}

func Load() (Config, error) {
	cfg := Config{
		Port: envInt("PORT", 8080),

		PostgresHost:     envStr("POSTGRES_HOST", "localhost"),
		PostgresPort:     envInt("POSTGRES_PORT", 5432),
		PostgresDB:       envStr("POSTGRES_DB", "nexus"),
		PostgresUser:     envStr("POSTGRES_USER", "postgres"),
		PostgresPassword: envStr("POSTGRES_PASSWORD", "postgres"),
		PostgresPoolMax:  envInt("POSTGRES_POOL_MAX", 20),
		// "disable" matches the original TS services, which pass no `ssl` option to
		// `pg.Pool` (node-postgres defaults to no TLS) — appropriate for local/docker-compose
		// Postgres. Override via POSTGRES_SSLMODE (e.g. "verify-full") for any environment
		// where Postgres is reachable over an untrusted network.
		PostgresSSLMode: envStr("POSTGRES_SSLMODE", "disable"),

		RedisHost:     envStr("REDIS_HOST", "localhost"),
		RedisPort:     envInt("REDIS_PORT", 6379),
		RedisPassword: envStr("REDIS_PASSWORD", ""),
		RedisDB:       envInt("REDIS_DB", 0),

		JWTAccessSecret:  os.Getenv("JWT_ACCESS_SECRET"),
		JWTRefreshSecret: os.Getenv("JWT_REFRESH_SECRET"),
		JWTAccessExpiry:  envDuration("JWT_ACCESS_EXPIRY", 15*time.Minute),
		JWTRefreshExpiry: envDuration("JWT_REFRESH_EXPIRY", 7*24*time.Hour),

		CORSOrigins: envList("CORS_ORIGINS", []string{"http://localhost:3000"}),
		NodeEnv:     envStr("NODE_ENV", "development"),

		SMTPHost:     envStr("SMTP_HOST", "smtp.gmail.com"),
		SMTPPort:     envInt("SMTP_PORT", 587),
		SMTPUser:     envStr("SMTP_USER", ""),
		SMTPPassword: envStr("SMTP_PASSWORD", ""),
		EmailFrom:    envStr("EMAIL_FROM", "noreply@nexus.com"),

		StorageBucket: envStr("STORAGE_BUCKET", "nexus-profiles"),
		StorageRegion: envStr("STORAGE_REGION", "us-east-1"),
	}

	if cfg.JWTAccessSecret == "" || cfg.JWTRefreshSecret == "" {
		return Config{}, fmt.Errorf("config: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must both be set (no hardcoded fallback, unlike the original TypeScript services)")
	}

	return cfg, nil
}

func (c Config) PostgresDSN() string {
	sslMode := c.PostgresSSLMode
	if sslMode == "" {
		sslMode = "disable"
	}
	return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=%s",
		url.QueryEscape(c.PostgresUser), url.QueryEscape(c.PostgresPassword),
		c.PostgresHost, c.PostgresPort, c.PostgresDB, sslMode)
}

func (c Config) RedisAddr() string {
	return fmt.Sprintf("%s:%d", c.RedisHost, c.RedisPort)
}

func envStr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(normalizeDuration(v)); err == nil {
			return d
		}
	}
	return def
}

// normalizeDuration converts the TS-style "15m"/"7d" expiry strings
// (used in backend/.env.example) into Go's time.ParseDuration format,
// which lacks a "d" (day) unit.
func normalizeDuration(v string) string {
	if strings.HasSuffix(v, "d") {
		days := strings.TrimSuffix(v, "d")
		if n, err := strconv.Atoi(days); err == nil {
			return fmt.Sprintf("%dh", n*24)
		}
	}
	return v
}

func envList(key string, def []string) []string {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	parts := strings.Split(v, ",")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return parts
}

package config_test

import (
	"testing"
	"time"

	"nexus-connect/backend-go/internal/platform/config"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoad_AppliesDefaults(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "test-access-secret-at-least-32-chars")
	t.Setenv("JWT_REFRESH_SECRET", "test-refresh-secret-at-least-32-chars")

	cfg, err := config.Load()
	require.NoError(t, err)

	assert.Equal(t, "localhost", cfg.PostgresHost)
	assert.Equal(t, 5432, cfg.PostgresPort)
	assert.Equal(t, "nexus", cfg.PostgresDB)
	assert.Equal(t, 20, cfg.PostgresPoolMax)
	assert.Equal(t, "localhost", cfg.RedisHost)
	assert.Equal(t, 6379, cfg.RedisPort)
	assert.Equal(t, 15*time.Minute, cfg.JWTAccessExpiry)
	assert.Equal(t, 7*24*time.Hour, cfg.JWTRefreshExpiry)
}

func TestLoad_FailsClosedWithoutJWTSecrets(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "")
	t.Setenv("JWT_REFRESH_SECRET", "")

	_, err := config.Load()
	require.Error(t, err, "must fail rather than silently use a hardcoded dev secret")
}

func TestLoad_ParsesCORSOriginsList(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "x-access-secret-at-least-32-characters")
	t.Setenv("JWT_REFRESH_SECRET", "x-refresh-secret-at-least-32-characters")
	t.Setenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173")

	cfg, err := config.Load()
	require.NoError(t, err)
	assert.Equal(t, []string{"http://localhost:3000", "http://localhost:5173"}, cfg.CORSOrigins)
}

func TestPostgresDSN_Format(t *testing.T) {
	cfg := config.Config{
		PostgresHost: "db", PostgresPort: 5432, PostgresDB: "nexus",
		PostgresUser: "postgres", PostgresPassword: "secret",
	}
	assert.Equal(t, "postgres://postgres:secret@db:5432/nexus?sslmode=disable", cfg.PostgresDSN(),
		"a zero-value PostgresSSLMode must fall back to \"disable\" so existing local-dev config literals keep working")
}

func TestPostgresDSN_UsesConfiguredSSLMode(t *testing.T) {
	cfg := config.Config{
		PostgresHost: "db", PostgresPort: 5432, PostgresDB: "nexus",
		PostgresUser: "postgres", PostgresPassword: "secret", PostgresSSLMode: "verify-full",
	}
	assert.Equal(t, "postgres://postgres:secret@db:5432/nexus?sslmode=verify-full", cfg.PostgresDSN())
}

func TestPostgresDSN_EscapesSpecialCharactersInCredentials(t *testing.T) {
	cfg := config.Config{
		PostgresHost: "db", PostgresPort: 5432, PostgresDB: "nexus",
		PostgresUser: "post/gres", PostgresPassword: "p@ss:w/ord?#",
	}
	assert.Equal(t, "postgres://post%2Fgres:p%40ss%3Aw%2Ford%3F%23@db:5432/nexus?sslmode=disable", cfg.PostgresDSN(),
		"special characters in user/password must be percent-encoded or the DSN is malformed/misparsed")
}

func TestLoad_SSLModeDefaultsToDisableForLocalDev(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "test-access-secret-at-least-32-chars")
	t.Setenv("JWT_REFRESH_SECRET", "test-refresh-secret-at-least-32-chars")
	t.Setenv("POSTGRES_SSLMODE", "")

	cfg, err := config.Load()
	require.NoError(t, err)
	assert.Equal(t, "disable", cfg.PostgresSSLMode)
}

func TestLoad_SSLModeConfigurableViaEnv(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "test-access-secret-at-least-32-chars")
	t.Setenv("JWT_REFRESH_SECRET", "test-refresh-secret-at-least-32-chars")
	t.Setenv("POSTGRES_SSLMODE", "verify-full")

	cfg, err := config.Load()
	require.NoError(t, err)
	assert.Equal(t, "verify-full", cfg.PostgresSSLMode)
}

func TestRedisAddr_Format(t *testing.T) {
	cfg := config.Config{RedisHost: "cache", RedisPort: 6380}
	assert.Equal(t, "cache:6380", cfg.RedisAddr())
}

func TestLoad_AppliesSMTPDefaults(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "test-access-secret-at-least-32-chars")
	t.Setenv("JWT_REFRESH_SECRET", "test-refresh-secret-at-least-32-chars")

	cfg, err := config.Load()
	require.NoError(t, err)

	assert.Equal(t, "smtp.gmail.com", cfg.SMTPHost)
	assert.Equal(t, 587, cfg.SMTPPort)
	assert.Equal(t, "", cfg.SMTPUser)
	assert.Equal(t, "noreply@nexus.com", cfg.EmailFrom)
}

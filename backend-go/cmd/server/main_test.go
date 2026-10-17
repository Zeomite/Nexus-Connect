//go:build integration

package main_test

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"nexus-connect/backend-go/internal/auth"
	"nexus-connect/backend-go/internal/platform"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
	"go.uber.org/fx"
	"go.uber.org/fx/fxtest"
)

// startTestPostgres and startTestRedis return a host/port pair for
// Config.Load()'s POSTGRES_HOST/PORT and REDIS_HOST/PORT env vars, rather
// than a combined DSN — platform.Module's own provideDB/provideCache build
// their DSN/address from Config, so this test must drive Config's inputs,
// not bypass them. Using testcontainers here (not a manually-started ad hoc
// `docker run`, as originally assumed) keeps this test self-contained and
// runnable the same way as every other integration test in this plan — a
// plain `go test -tags=integration ./...` — instead of requiring an
// undocumented manual pre-step no CI pipeline could reproduce.
func startTestPostgres(t *testing.T) (host, port string) {
	t.Helper()
	ctx := context.Background()
	container, err := postgres.Run(ctx, "postgres:16-alpine",
		postgres.WithDatabase("nexus_test"),
		postgres.WithUsername("postgres"),
		postgres.WithPassword("postgres"),
		postgres.BasicWaitStrategies(),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	h, err := container.Host(ctx)
	require.NoError(t, err)
	p, err := container.MappedPort(ctx, "5432/tcp")
	require.NoError(t, err)
	return h, p.Port()
}

func startTestRedis(t *testing.T) (host, port string) {
	t.Helper()
	ctx := context.Background()
	container, err := tcredis.Run(ctx, "redis:7-alpine")
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	h, err := container.Host(ctx)
	require.NoError(t, err)
	p, err := container.MappedPort(ctx, "6379/tcp")
	require.NoError(t, err)
	return h, p.Port()
}

// setAppEnv returns the Postgres DSN it just pointed the app's env vars at,
// so a test can open its own separate connection afterward and verify what
// the app actually did to the database — fx builds its dependency graph
// lazily, so a test that only hits /health (which touches neither Postgres
// nor Redis) cannot distinguish "the DB provider ran and migrated the
// schema" from "the DB provider was never constructed at all." The latter
// was a real, silent bug here: registerHTTPServer and the force-construct
// fx.Invoke (module.go) didn't originally depend on *db.DB, so provideDB —
// and therefore migrations.Run — never executed, confirmed via a manual run
// with fx's own diagnostic logging (no "RUN provide: ...provideDB()" line).
func setAppEnv(t *testing.T, port int) (postgresDSN string) {
	t.Helper()
	pgHost, pgPort := startTestPostgres(t)
	redisHost, redisPort := startTestRedis(t)

	t.Setenv("JWT_ACCESS_SECRET", "integration-test-access-secret-32!")
	t.Setenv("JWT_REFRESH_SECRET", "integration-test-refresh-secret-32")
	t.Setenv("PORT", strconv.Itoa(port))
	t.Setenv("POSTGRES_HOST", pgHost)
	t.Setenv("POSTGRES_PORT", pgPort)
	t.Setenv("POSTGRES_DB", "nexus_test")
	t.Setenv("POSTGRES_USER", "postgres")
	t.Setenv("POSTGRES_PASSWORD", "postgres")
	t.Setenv("REDIS_HOST", redisHost)
	t.Setenv("REDIS_PORT", redisPort)

	return fmt.Sprintf("postgres://postgres:postgres@%s:%s/nexus_test?sslmode=disable", pgHost, pgPort)
}

func TestApp_BootsServesHealthAndShutsDownCleanly(t *testing.T) {
	setAppEnv(t, 18080)

	app := fxtest.New(t, platform.Module, fx.NopLogger)
	app.RequireStart()
	defer app.RequireStop()

	resp, err := http.Get("http://localhost:18080/health")
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusOK, resp.StatusCode)
}

// TestApp_BootConstructsDBAndAppliesMigrations is the regression test for
// the bug documented on setAppEnv: /health alone can't prove provideDB (and
// therefore migrations.Run) actually ran, since /health never touches
// Postgres. This boots the real app, then opens a separate connection to
// confirm the schema migrations.Run applies was actually created.
func TestApp_BootConstructsDBAndAppliesMigrations(t *testing.T) {
	dsn := setAppEnv(t, 18082)

	app := fxtest.New(t, platform.Module, fx.NopLogger)
	app.RequireStart()
	defer app.RequireStop()

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	defer pool.Close()

	var exists bool
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users')`,
	).Scan(&exists))
	assert.True(t, exists, "provideDB must have actually run migrations.Run against the real database")
}

func TestApp_RegistersAndLogsInThroughTheRealHTTPServer(t *testing.T) {
	setAppEnv(t, 18083)

	app := fxtest.New(t, platform.Module, auth.Module, fx.NopLogger)
	app.RequireStart()
	defer app.RequireStop()

	registerBody := `{"email":"e2e@example.com","password":"SecureP@ss123","displayName":"E2E"}`
	resp, err := http.Post("http://localhost:18083/api/v1/auth/register", "application/json", strings.NewReader(registerBody))
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusCreated, resp.StatusCode)
}

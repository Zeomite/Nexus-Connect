//go:build integration

package migrations_test

import (
	"context"
	"testing"

	"nexus-connect/backend-go/internal/platform/migrations"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
)

// startPostgres applies postgres.BasicWaitStrategies() — see
// backend-go/internal/platform/db/db_test.go's startPostgres for why: without
// it, testcontainers considers the container ready after Postgres' first
// startup, before its self-restart, producing "connection reset by peer".
func startPostgres(t *testing.T) string {
	t.Helper()
	ctx := context.Background()
	container, err := postgres.Run(ctx, "postgres:16-alpine",
		postgres.WithDatabase("nexus_migrate_test"),
		postgres.WithUsername("postgres"),
		postgres.WithPassword("postgres"),
		postgres.BasicWaitStrategies(),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })
	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err)
	return dsn
}

func TestRun_CreatesAllTables(t *testing.T) {
	dsn := startPostgres(t)
	require.NoError(t, migrations.Run(dsn))

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	defer pool.Close()

	expectedTables := []string{
		"users", "chats", "chat_participants", "messages", "calls",
		"call_participants", "call_history", "groups", "group_members",
		"expenses", "expense_splits", "ledger_entries",
	}

	for _, table := range expectedTables {
		var exists bool
		err := pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
			table,
		).Scan(&exists)
		require.NoError(t, err)
		assert.True(t, exists, "expected table %q to exist after migration", table)
	}
}

func TestRun_IsIdempotent(t *testing.T) {
	dsn := startPostgres(t)
	require.NoError(t, migrations.Run(dsn))
	require.NoError(t, migrations.Run(dsn), "running migrations twice must not error")
}

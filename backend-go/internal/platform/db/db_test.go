//go:build integration

package db_test

import (
	"context"
	"testing"
	"time"

	"nexus-connect/backend-go/internal/platform/db"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
)

func startPostgres(t *testing.T) string {
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

	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err)
	return dsn
}

func TestNew_ConnectsAndHealthChecks(t *testing.T) {
	dsn := startPostgres(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := db.New(ctx, dsn, 5)
	require.NoError(t, err)
	defer pool.Close()

	assert.NoError(t, pool.HealthCheck(ctx))
}

func TestQueryRow_ReturnsValue(t *testing.T) {
	dsn := startPostgres(t)
	ctx := context.Background()
	pool, err := db.New(ctx, dsn, 5)
	require.NoError(t, err)
	defer pool.Close()

	var result int
	err = pool.QueryRow(ctx, "SELECT 1 + 1").Scan(&result)
	require.NoError(t, err)
	assert.Equal(t, 2, result)
}

func TestTransaction_RollsBackOnError(t *testing.T) {
	dsn := startPostgres(t)
	ctx := context.Background()
	pool, err := db.New(ctx, dsn, 5)
	require.NoError(t, err)
	defer pool.Close()

	_, err = pool.Exec(ctx, "CREATE TABLE tx_rollback_test (id INT PRIMARY KEY)")
	require.NoError(t, err)

	txErr := pool.Transaction(ctx, func(tx pgx.Tx) error {
		_, execErr := tx.Exec(ctx, "INSERT INTO tx_rollback_test (id) VALUES (1)")
		require.NoError(t, execErr)
		return assert.AnError // force rollback
	})
	require.Error(t, txErr)

	var count int
	require.NoError(t, pool.QueryRow(ctx, "SELECT COUNT(*) FROM tx_rollback_test").Scan(&count))
	assert.Equal(t, 0, count, "insert must have been rolled back")
}

func TestTransaction_CommitsOnSuccess(t *testing.T) {
	dsn := startPostgres(t)
	ctx := context.Background()
	pool, err := db.New(ctx, dsn, 5)
	require.NoError(t, err)
	defer pool.Close()

	_, err = pool.Exec(ctx, "CREATE TABLE tx_commit_test (id INT PRIMARY KEY)")
	require.NoError(t, err)

	err = pool.Transaction(ctx, func(tx pgx.Tx) error {
		_, execErr := tx.Exec(ctx, "INSERT INTO tx_commit_test (id) VALUES (1)")
		return execErr
	})
	require.NoError(t, err)

	var count int
	require.NoError(t, pool.QueryRow(ctx, "SELECT COUNT(*) FROM tx_commit_test").Scan(&count))
	assert.Equal(t, 1, count)
}

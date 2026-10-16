//go:build integration

package auth_test

import (
	"context"
	"testing"

	"nexus-connect/backend-go/internal/auth"
	platformdb "nexus-connect/backend-go/internal/platform/db"
	"nexus-connect/backend-go/internal/platform/migrations"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
)

// startStore spins up a fresh Postgres container, migrates it, and returns a
// Store ready to use — mirrors the pattern already established in the
// foundation plan's db_test.go/migrations_test.go, including the
// BasicWaitStrategies() fix (without it, testcontainers considers the
// container ready after Postgres' first startup, before its self-restart,
// producing "connection reset by peer" on the first real connection).
func startStore(t *testing.T) *auth.Store {
	t.Helper()
	ctx := context.Background()

	container, err := postgres.Run(ctx, "postgres:16-alpine",
		postgres.WithDatabase("nexus_auth_test"),
		postgres.WithUsername("postgres"),
		postgres.WithPassword("postgres"),
		postgres.BasicWaitStrategies(),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err)
	require.NoError(t, migrations.Run(dsn))

	pool, err := platformdb.New(ctx, dsn, 5)
	require.NoError(t, err)
	t.Cleanup(pool.Close)

	return auth.NewStore(pool)
}

func TestStore_ExistsByEmail_FalseThenTrueAfterInsert(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()

	exists, err := store.ExistsByEmail(ctx, "new@example.com")
	require.NoError(t, err)
	assert.False(t, exists)

	require.NoError(t, store.InsertUser(ctx, "00000000-0000-0000-0000-000000000001", "new@example.com", "hash", "1234567890", "Jane"))

	exists, err = store.ExistsByEmail(ctx, "new@example.com")
	require.NoError(t, err)
	assert.True(t, exists)
}

func TestStore_ExistsByUniqueNumber_FalseThenTrueAfterInsert(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()

	exists, err := store.ExistsByUniqueNumber(ctx, "9998887770")
	require.NoError(t, err)
	assert.False(t, exists)

	require.NoError(t, store.InsertUser(ctx, "00000000-0000-0000-0000-000000000002", "num@example.com", "hash", "9998887770", "Num"))

	exists, err = store.ExistsByUniqueNumber(ctx, "9998887770")
	require.NoError(t, err)
	assert.True(t, exists)
}

func TestStore_InsertUser_DefaultsEmailVerifiedFalse(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	require.NoError(t, store.InsertUser(ctx, "00000000-0000-0000-0000-000000000003", "unverified@example.com", "hash", "1112223334", "Unverified"))

	user, err := store.FindForLogin(ctx, "unverified@example.com")
	require.NoError(t, err)
	require.NotNil(t, user)
	assert.False(t, user.EmailVerified)
}

func TestStore_FindForLogin_NilWhenNotFound(t *testing.T) {
	store := startStore(t)
	user, err := store.FindForLogin(context.Background(), "nobody@example.com")
	require.NoError(t, err)
	assert.Nil(t, user)
}

func TestStore_FindForLogin_ReturnsAllFields(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	require.NoError(t, store.InsertUser(ctx, "00000000-0000-0000-0000-000000000004", "full@example.com", "the-hash", "5551112223", "Full Name"))

	user, err := store.FindForLogin(ctx, "full@example.com")
	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, "00000000-0000-0000-0000-000000000004", user.ID)
	assert.Equal(t, "full@example.com", user.Email)
	assert.Equal(t, "the-hash", user.PasswordHash)
	assert.Equal(t, "5551112223", user.UniqueNumber)
	assert.Equal(t, "Full Name", user.DisplayName)
	assert.False(t, user.EmailVerified)
}

func TestStore_FindEmailVerified_NilWhenNotFound(t *testing.T) {
	store := startStore(t)
	lookup, err := store.FindEmailVerified(context.Background(), "nobody@example.com")
	require.NoError(t, err)
	assert.Nil(t, lookup)
}

func TestStore_MarkEmailVerified_UpdatesRowAndReportsFound(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	require.NoError(t, store.InsertUser(ctx, "00000000-0000-0000-0000-000000000005", "verify-me@example.com", "hash", "2223334445", "VerifyMe"))

	found, err := store.MarkEmailVerified(ctx, "00000000-0000-0000-0000-000000000005")
	require.NoError(t, err)
	assert.True(t, found)

	lookup, err := store.FindEmailVerified(ctx, "verify-me@example.com")
	require.NoError(t, err)
	require.NotNil(t, lookup)
	assert.True(t, lookup.EmailVerified)
}

func TestStore_MarkEmailVerified_ReportsNotFoundForMissingUser(t *testing.T) {
	store := startStore(t)
	found, err := store.MarkEmailVerified(context.Background(), "00000000-0000-0000-0000-000000000099")
	require.NoError(t, err)
	assert.False(t, found)
}

func TestStore_UpdatePassword_ChangesHashAndReportsFound(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	require.NoError(t, store.InsertUser(ctx, "00000000-0000-0000-0000-000000000006", "pw@example.com", "old-hash", "3334445556", "PwUser"))

	found, err := store.UpdatePassword(ctx, "00000000-0000-0000-0000-000000000006", "new-hash")
	require.NoError(t, err)
	assert.True(t, found)

	user, err := store.FindForLogin(ctx, "pw@example.com")
	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, "new-hash", user.PasswordHash)
}

func TestStore_UpdateLastSeen_Succeeds(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	require.NoError(t, store.InsertUser(ctx, "00000000-0000-0000-0000-000000000007", "lastseen@example.com", "hash", "4445556667", "LastSeen"))
	assert.NoError(t, store.UpdateLastSeen(ctx, "00000000-0000-0000-0000-000000000007"))
}

func TestStore_FindIDByEmail_NilWhenNotFound(t *testing.T) {
	store := startStore(t)
	id, err := store.FindIDByEmail(context.Background(), "nobody@example.com")
	require.NoError(t, err)
	assert.Nil(t, id)
}

func TestStore_FindIDByEmail_ReturnsIDWhenFound(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	require.NoError(t, store.InsertUser(ctx, "00000000-0000-0000-0000-000000000008", "findid@example.com", "hash", "6667778889", "FindID"))

	id, err := store.FindIDByEmail(ctx, "findid@example.com")
	require.NoError(t, err)
	require.NotNil(t, id)
	assert.Equal(t, "00000000-0000-0000-0000-000000000008", *id)
}

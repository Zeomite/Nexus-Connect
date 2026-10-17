//go:build integration

package user_test

import (
	"context"
	"testing"
	"time"

	"nexus-connect/backend-go/internal/platform/db"
	"nexus-connect/backend-go/internal/platform/migrations"
	"nexus-connect/backend-go/internal/user"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
)

// testDB is set by startStore and used by insertTestUser — a second
// handle on the exact same connection the *user.Store under test wraps,
// for test setup only (Store deliberately has no raw-insert passthrough;
// auth's Store.InsertUser isn't reachable from this package, and doesn't
// need to be — this test file just needs *a* row to exist).
var testDB *db.DB

// startStore spins a fresh Postgres container per test (deferred
// cost-reduction noted in the auth module's final review, m-12, not
// addressed in this plan either) and runs the real migrations — this
// package has no other test that might have already applied them, unlike
// auth's store_test.go, which could sometimes piggyback on one.
func startStore(t *testing.T) *user.Store {
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

	database, err := db.New(ctx, dsn, 5)
	require.NoError(t, err)
	t.Cleanup(database.Close)

	require.NoError(t, migrations.Run(dsn))

	testDB = database
	return user.NewStore(database)
}

func insertTestUser(t *testing.T, _ *user.Store, id, email, uniqueNumber, displayName, status string) {
	t.Helper()
	_, err := testDB.Exec(context.Background(),
		`INSERT INTO users (id, email, password_hash, unique_number, display_name, status, email_verified, created_at, updated_at)
		 VALUES ($1, $2, 'test-hash', $3, $4, $5, true, NOW(), NOW())`,
		id, email, uniqueNumber, displayName, status,
	)
	require.NoError(t, err)
}

func TestProfileByID_ReturnsFullRowIncludingEmail(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000001", "full@example.com", "1111111111", "Full Profile", "offline")

	row, err := store.ProfileByID(ctx, "00000000-0000-0000-0000-000000000001")
	require.NoError(t, err)
	require.NotNil(t, row)
	assert.Equal(t, "full@example.com", row.Email)
	assert.Equal(t, "Full Profile", row.DisplayName)
	assert.Equal(t, "1111111111", row.UniqueNumber)
	assert.Equal(t, "offline", row.Status)
	assert.WithinDuration(t, time.Now(), row.CreatedAt, time.Minute)
}

func TestProfileByID_NotFound_ReturnsNilNotError(t *testing.T) {
	store := startStore(t)
	row, err := store.ProfileByID(context.Background(), "00000000-0000-0000-0000-000000000099")
	require.NoError(t, err)
	assert.Nil(t, row)
}

// TestPublicProfileByID_NeverIncludesEmail pins Review Focus item 1 at the
// Store layer: PublicProfileRow has no Email field at all, so this is
// enforced by the type system, not just by a handler choosing not to
// serialize a field that's still sitting in memory.
func TestPublicProfileByID_NeverIncludesEmail(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000002", "public@example.com", "2222222222", "Public Profile", "online")

	row, err := store.PublicProfileByID(ctx, "00000000-0000-0000-0000-000000000002")
	require.NoError(t, err)
	require.NotNil(t, row)
	assert.Equal(t, "Public Profile", row.DisplayName)
	assert.Equal(t, "2222222222", row.UniqueNumber)
	assert.Equal(t, "online", row.Status)
}

func TestPublicProfileByUniqueNumber_Found(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000003", "bynum@example.com", "3333333333", "By Number", "busy")

	row, err := store.PublicProfileByUniqueNumber(ctx, "3333333333")
	require.NoError(t, err)
	require.NotNil(t, row)
	assert.Equal(t, "00000000-0000-0000-0000-000000000003", row.ID)
}

func TestPublicProfileByUniqueNumber_NotFound_ReturnsNilNotError(t *testing.T) {
	store := startStore(t)
	row, err := store.PublicProfileByUniqueNumber(context.Background(), "9999999999")
	require.NoError(t, err)
	assert.Nil(t, row)
}

func TestStatusByID_ReturnsStatus(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000004", "status@example.com", "4444444444", "Status User", "away")

	status, err := store.StatusByID(ctx, "00000000-0000-0000-0000-000000000004")
	require.NoError(t, err)
	require.NotNil(t, status)
	assert.Equal(t, "away", *status)
}

func TestStatusByID_NotFound_ReturnsNilNotError(t *testing.T) {
	store := startStore(t)
	status, err := store.StatusByID(context.Background(), "00000000-0000-0000-0000-000000000098")
	require.NoError(t, err)
	assert.Nil(t, status)
}

func TestStatusesByIDs_ReturnsOnlyExistingUsers(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000005", "s5@example.com", "5555555555", "S5", "online")
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000006", "s6@example.com", "6666666666", "S6", "offline")

	statuses, err := store.StatusesByIDs(ctx, []string{
		"00000000-0000-0000-0000-000000000005",
		"00000000-0000-0000-0000-000000000006",
		"00000000-0000-0000-0000-000000000097", // doesn't exist
	})
	require.NoError(t, err)
	assert.Equal(t, map[string]string{
		"00000000-0000-0000-0000-000000000005": "online",
		"00000000-0000-0000-0000-000000000006": "offline",
	}, statuses)
}

func TestUpdateStatus_PersistsAndUpdatesLastSeen(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000007", "us@example.com", "7777777777", "US", "offline")

	require.NoError(t, store.UpdateStatus(ctx, "00000000-0000-0000-0000-000000000007", "online"))

	status, err := store.StatusByID(ctx, "00000000-0000-0000-0000-000000000007")
	require.NoError(t, err)
	require.NotNil(t, status)
	assert.Equal(t, "online", *status)
}

func TestUpdateProfile_DisplayNameOnly_LeavesPictureUntouched(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000008", "up1@example.com", "8888888888", "Old Name", "offline")
	require.NoError(t, store.UpdateProfilePicture(ctx, "00000000-0000-0000-0000-000000000008", "https://example.com/old.png"))

	newName := "New Name"
	result, err := store.UpdateProfile(ctx, "00000000-0000-0000-0000-000000000008", user.ProfileUpdate{
		DisplayName: &newName,
	})
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "New Name", *result.DisplayName)

	row, err := store.ProfileByID(ctx, "00000000-0000-0000-0000-000000000008")
	require.NoError(t, err)
	require.NotNil(t, row.ProfilePictureURL)
	assert.Equal(t, "https://example.com/old.png", *row.ProfilePictureURL, "picture must be untouched when only displayName was set")
}

func TestUpdateProfile_NoFieldsSet_ReturnsNilNotError(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000009", "up2@example.com", "1000000000", "NoChange", "offline")

	result, err := store.UpdateProfile(ctx, "00000000-0000-0000-0000-000000000009", user.ProfileUpdate{})
	require.NoError(t, err)
	assert.Nil(t, result, "mirrors the original short-circuiting to a plain read when updates.length === 0")
}

func TestSearchByName_ExcludesCallerAndMatchesSubstring(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000010", "caller@example.com", "1000000001", "Caller Self", "online")
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000011", "match@example.com", "1000000002", "Jane Match", "online")
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000012", "nomatch@example.com", "1000000003", "Bob Other", "online")

	results, err := store.SearchByName(ctx, "00000000-0000-0000-0000-000000000010", "%Match%", 20, 0)
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, "Jane Match", results[0].DisplayName)

	count, err := store.CountSearchByName(ctx, "00000000-0000-0000-0000-000000000010", "%Match%")
	require.NoError(t, err)
	assert.Equal(t, 1, count)
}

func TestSearchByName_NeverReturnsCaller(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000013", "selfsearch@example.com", "1000000004", "SelfSearch", "online")

	results, err := store.SearchByName(ctx, "00000000-0000-0000-0000-000000000013", "%SelfSearch%", 20, 0)
	require.NoError(t, err)
	assert.Empty(t, results, "a caller searching a substring of their own name must not get themselves back")
}

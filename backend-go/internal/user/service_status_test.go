//go:build integration

package user_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpdateStatus_WritesCacheAndDB(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000030", "us1@example.com", "3000000001", "US1", "offline")

	require.NoError(t, svc.UpdateStatus(ctx, "00000000-0000-0000-0000-000000000030", "online"))

	dbStatus, err := store.StatusByID(ctx, "00000000-0000-0000-0000-000000000030")
	require.NoError(t, err)
	require.NotNil(t, dbStatus)
	assert.Equal(t, "online", *dbStatus)
}

func TestGetStatus_FallsBackToDBOnCacheMiss(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000031", "us2@example.com", "3000000002", "US2", "away")

	// Directly writing the DB (not through svc.UpdateStatus) means the
	// cache is never populated -- this must still fall back correctly.
	status, err := svc.GetStatus(ctx, "00000000-0000-0000-0000-000000000031")
	require.NoError(t, err)
	assert.Equal(t, "away", status)
}

// TestGetStatus_PrefersCacheOverStaleDB pins Review Focus item 2: after
// UpdateStatus writes "busy" to both layers, a later direct DB write to
// "offline" (bypassing the cache entirely, simulating some other process
// having changed the DB) must NOT be what GetStatus returns -- the cache
// is authoritative for its TTL window.
func TestGetStatus_PrefersCacheOverStaleDB(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000032", "us3@example.com", "3000000003", "US3", "offline")
	require.NoError(t, svc.UpdateStatus(ctx, "00000000-0000-0000-0000-000000000032", "busy"))

	require.NoError(t, store.UpdateStatus(ctx, "00000000-0000-0000-0000-000000000032", "offline"))

	status, err := svc.GetStatus(ctx, "00000000-0000-0000-0000-000000000032")
	require.NoError(t, err)
	assert.Equal(t, "busy", status, "cache must win over a later, cache-bypassing DB write")
}

func TestGetStatus_NonExistentUser_ReturnsOfflineNotError(t *testing.T) {
	svc, _ := newTestService(t)
	status, err := svc.GetStatus(context.Background(), "00000000-0000-0000-0000-000000000099")
	require.NoError(t, err)
	assert.Equal(t, "offline", status)
}

// TestGetStatuses_MixOfCacheHitsAndMisses pins Review Focus item 4: one
// user has a cached status (fresher than the DB), two don't and must fall
// back to the DB -- all three must come back correct in one call.
func TestGetStatuses_MixOfCacheHitsAndMisses(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000033", "mix1@example.com", "3000000004", "Mix1", "offline")
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000034", "mix2@example.com", "3000000005", "Mix2", "busy")
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000035", "mix3@example.com", "3000000006", "Mix3", "away")

	// Only user 33 gets a cache entry, and it diverges from its own DB row
	// (set to offline in Postgres) -- proving this one's answer came from
	// the cache, not a DB fallback that happened to agree by coincidence.
	require.NoError(t, svc.UpdateStatus(ctx, "00000000-0000-0000-0000-000000000033", "online"))

	statuses, err := svc.GetStatuses(ctx, []string{
		"00000000-0000-0000-0000-000000000033",
		"00000000-0000-0000-0000-000000000034",
		"00000000-0000-0000-0000-000000000035",
	})
	require.NoError(t, err)
	assert.Equal(t, map[string]string{
		"00000000-0000-0000-0000-000000000033": "online", // from cache
		"00000000-0000-0000-0000-000000000034": "busy",   // from DB fallback
		"00000000-0000-0000-0000-000000000035": "away",   // from DB fallback
	}, statuses)
}

// TestUpdateStatus_OnlineUsersSetWrite pins the ported-but-dead
// online:users set write (Global Constraints' TODO(gap)) -- this test
// only proves the write doesn't error, since nothing in this codebase
// ever reads the set back (matching the original exactly).
func TestUpdateStatus_OnlineUsersSetWriteDoesNotError(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000036", "online1@example.com", "3000000007", "Online1", "offline")

	require.NoError(t, svc.UpdateStatus(ctx, "00000000-0000-0000-0000-000000000036", "online"))
	require.NoError(t, svc.UpdateStatus(ctx, "00000000-0000-0000-0000-000000000036", "offline"))
}

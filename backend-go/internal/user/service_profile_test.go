//go:build integration

package user_test

import (
	"bytes"
	"context"
	"testing"
	"time"

	"nexus-connect/backend-go/internal/platform/cache"
	"nexus-connect/backend-go/internal/platform/config"
	"nexus-connect/backend-go/internal/platform/events"
	"nexus-connect/backend-go/internal/platform/logger"
	"nexus-connect/backend-go/internal/user"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
)

func startCacheForUser(t *testing.T) *cache.Cache {
	t.Helper()
	ctx := context.Background()
	container, err := tcredis.Run(ctx, "redis:7-alpine")
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })
	connStr, err := container.ConnectionString(ctx)
	require.NoError(t, err)
	return cache.New(stripRedisScheme(connStr), "", 0)
}

func stripRedisScheme(connStr string) string {
	const prefix = "redis://"
	if len(connStr) >= len(prefix) && connStr[:len(prefix)] == prefix {
		return connStr[len(prefix):]
	}
	return connStr
}

func newTestService(t *testing.T) (*user.Service, *user.Store) {
	t.Helper()
	store := startStore(t) // from store_test.go, same package
	c := startCacheForUser(t)
	bus := events.NewBus(logger.New("test"))
	cfg := config.Config{StorageBucket: "test-bucket", StorageRegion: "us-east-1"}
	return user.NewService(store, c, bus, cfg, logger.New("test")), store
}

func TestGetProfile_ReturnsFullProfileIncludingEmail(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000020", "getprofile@example.com", "2000000001", "Get Profile", "offline")

	profile, err := svc.GetProfile(ctx, "00000000-0000-0000-0000-000000000020")
	require.NoError(t, err)
	assert.Equal(t, "getprofile@example.com", profile.Email)
	assert.Equal(t, "Get Profile", profile.DisplayName)
}

// TestGetProfile_PrefersCachedStatusOverDBStatus pins Review Focus item 2.
// This writes the cached status directly via cache.Cache (not through
// Service.UpdateStatus, which doesn't exist until Task 7 — service_status.go
// — and this file, Task 6, must compile and pass on its own first) and a
// different value directly to the DB, to prove GetProfile's cache lookup
// wins regardless of which layer wrote more recently.
func TestGetProfile_PrefersCachedStatusOverDBStatus(t *testing.T) {
	store := startStore(t)
	c := startCacheForUser(t)
	bus := events.NewBus(logger.New("test"))
	cfg := config.Config{StorageBucket: "test-bucket", StorageRegion: "us-east-1"}
	svc := user.NewService(store, c, bus, cfg, logger.New("test"))
	ctx := context.Background()

	insertTestUser(t, store, "00000000-0000-0000-0000-000000000021", "cached@example.com", "2000000002", "Cached", "offline")
	require.NoError(t, store.UpdateStatus(ctx, "00000000-0000-0000-0000-000000000021", "offline"))
	require.NoError(t, c.Set(ctx, cache.UserStatusKey("00000000-0000-0000-0000-000000000021"), "busy", time.Minute))

	profile, err := svc.GetProfile(ctx, "00000000-0000-0000-0000-000000000021")
	require.NoError(t, err)
	assert.Equal(t, "busy", profile.Status, "cache (set directly to busy) must win over the DB's offline value")
}

func TestGetProfile_NotFound_ReturnsNotFoundError(t *testing.T) {
	svc, _ := newTestService(t)
	_, err := svc.GetProfile(context.Background(), "00000000-0000-0000-0000-000000000099")
	require.Error(t, err)
}

// TestGetProfile_GenuineCacheErrorFallsBackToDBAndLogs: a Review-driven
// regression test. cachedStatusOr's `if err != nil { return dbStatus }`
// used to treat a clean cache miss (cache.ErrNotFound) and a genuine Redis
// failure (connection refused, auth failure, etc.) identically -- falling
// back to the DB silently either way. The original (user.service.ts) has
// no try/catch around its Redis read, so a real Redis outage there fails
// the whole request instead of degrading silently. Failing open here is a
// deliberate, better choice than matching that fragility (Postgres has the
// durable data right there), but the silence was a real gap: an outage
// should be observable. This pins both halves: the fallback still happens
// (status comes from the DB), and it's now logged.
func TestGetProfile_GenuineCacheErrorFallsBackToDBAndLogs(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000027", "logtest@example.com", "2000000008", "LogTest", "offline")

	// Port 1 has nothing listening -- go-redis's lazy connection fails with
	// a real connection error on the first command, never cache.ErrNotFound.
	unreachableCache := cache.New("127.0.0.1:1", "", 0)
	bus := events.NewBus(logger.New("test"))
	cfg := config.Config{StorageBucket: "test-bucket", StorageRegion: "us-east-1"}
	var logBuf bytes.Buffer
	svc := user.NewService(store, unreachableCache, bus, cfg, logger.NewWithWriter("test", &logBuf))

	profile, err := svc.GetProfile(ctx, "00000000-0000-0000-0000-000000000027")
	require.NoError(t, err)
	assert.Equal(t, "offline", profile.Status, "a genuine cache error must still fall back to the DB value")
	assert.Contains(t, logBuf.String(), "WARN", "a genuine cache error (not a clean miss) must be logged, not silently swallowed")
}

// TestGetPublicProfile_ResponseNeverHasEmailField pins Review Focus item 1
// at the type level: PublicProfile has no Email field today, verified by
// direct inspection of the struct (service_profile.go) -- not, as an
// earlier version of this comment incorrectly claimed, because adding an
// unreferenced field to a Go struct would force a compile error anywhere.
// It wouldn't: Go happily compiles a struct with an added, unused field,
// and this test would keep passing unchanged even if PublicProfile grew
// an Email field tomorrow. The real guard against that regression is
// Task 10's TestHandlerGetByID_ResponseNeverContainsEmailKey, which checks
// the actual JSON wire body a client receives, not the Go type.
func TestGetPublicProfile_ResponseNeverHasEmailField(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000022", "shouldnotleak@example.com", "2000000003", "No Leak", "online")

	profile, err := svc.GetPublicProfile(ctx, "00000000-0000-0000-0000-000000000022")
	require.NoError(t, err)
	assert.Equal(t, "No Leak", profile.DisplayName)
}

func TestGetPublicProfile_NotFound_ReturnsNotFoundError(t *testing.T) {
	svc, _ := newTestService(t)
	_, err := svc.GetPublicProfile(context.Background(), "00000000-0000-0000-0000-000000000098")
	require.Error(t, err)
}

func TestUpdateProfile_DisplayNameOnly(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000023", "updname@example.com", "2000000004", "Old", "online")

	newName := "New"
	profile, err := svc.UpdateProfile(ctx, "00000000-0000-0000-0000-000000000023", user.ProfileUpdate{DisplayName: &newName})
	require.NoError(t, err)
	assert.Equal(t, "New", profile.DisplayName)
}

// TestUpdateProfile_OmittedPictureLeavesItUntouched pins Review Focus item
// 3's first case: no profilePictureUrl key at all in the update.
func TestUpdateProfile_OmittedPictureLeavesItUntouched(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000024", "omit@example.com", "2000000005", "Omit", "online")
	require.NoError(t, store.UpdateProfilePicture(ctx, "00000000-0000-0000-0000-000000000024", "https://example.com/existing.png"))

	newName := "Omit Updated"
	_, err := svc.UpdateProfile(ctx, "00000000-0000-0000-0000-000000000024", user.ProfileUpdate{DisplayName: &newName})
	require.NoError(t, err)

	profile, err := svc.GetProfile(ctx, "00000000-0000-0000-0000-000000000024")
	require.NoError(t, err)
	require.NotNil(t, profile.ProfilePictureURL)
	assert.Equal(t, "https://example.com/existing.png", *profile.ProfilePictureURL)
}

// TestUpdateProfile_ExplicitNullClearsPicture pins Review Focus item 3's
// second case: profilePictureUrl present and explicitly null.
func TestUpdateProfile_ExplicitNullClearsPicture(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000025", "clear@example.com", "2000000006", "Clear", "online")
	require.NoError(t, store.UpdateProfilePicture(ctx, "00000000-0000-0000-0000-000000000025", "https://example.com/toclear.png"))

	_, err := svc.UpdateProfile(ctx, "00000000-0000-0000-0000-000000000025", user.ProfileUpdate{
		ProfilePictureURL: user.OptionalString{Set: true, Value: nil},
	})
	require.NoError(t, err)

	profile, err := svc.GetProfile(ctx, "00000000-0000-0000-0000-000000000025")
	require.NoError(t, err)
	assert.Nil(t, profile.ProfilePictureURL, "an explicit null must clear the column")
}

// TestUpdateProfile_RealURLSetsPicture pins Review Focus item 3's third
// case: profilePictureUrl present with a real value.
func TestUpdateProfile_RealURLSetsPicture(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000026", "setpic@example.com", "2000000007", "SetPic", "online")

	url := "https://example.com/new.png"
	profile, err := svc.UpdateProfile(ctx, "00000000-0000-0000-0000-000000000026", user.ProfileUpdate{
		ProfilePictureURL: user.OptionalString{Set: true, Value: &url},
	})
	require.NoError(t, err)
	require.NotNil(t, profile.ProfilePictureURL)
	assert.Equal(t, "https://example.com/new.png", *profile.ProfilePictureURL)
}

// TestUpdateProfile_NoFieldsSet_ReturnsCurrentProfile closes a review gap:
// Store.UpdateProfile's zero-fields-set -> nil fallback was only tested at
// the Store layer (store_test.go, Task 4); this pins the Service's own
// fallback to GetPublicProfile on that nil, which store_test.go's test
// can't exercise since it calls Store directly, bypassing Service entirely.
func TestUpdateProfile_NoFieldsSet_ReturnsCurrentProfile(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000028", "nochange@example.com", "2000000009", "NoChange", "online")

	profile, err := svc.UpdateProfile(ctx, "00000000-0000-0000-0000-000000000028", user.ProfileUpdate{})
	require.NoError(t, err, "zero fields set must not error, it must fall back to reading the current profile")
	assert.Equal(t, "NoChange", profile.DisplayName)
}

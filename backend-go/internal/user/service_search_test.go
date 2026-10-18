//go:build integration

package user_test

import (
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
)

func TestFindByUniqueNumber_Found(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000040", "fbn@example.com", "4000000001", "FBN", "online")

	profile, err := svc.FindByUniqueNumber(ctx, "4000000001")
	require.NoError(t, err)
	assert.Equal(t, "FBN", profile.DisplayName)
}

// TestFindByUniqueNumber_PrefersCachedStatusOverDBStatus closes a review
// gap: TestFindByUniqueNumber_Found above only asserts DisplayName, never
// proving cachedStatusOr(ctx, row.ID, row.Status) is actually keyed by
// row.ID and not some other field (e.g. a mistaken row.UniqueNumber) --
// the same property Task 6/7 already pin for GetProfile/GetStatus.
func TestFindByUniqueNumber_PrefersCachedStatusOverDBStatus(t *testing.T) {
	store := startStore(t)
	c := startCacheForUser(t)
	bus := events.NewBus(logger.New("test"))
	cfg := config.Config{StorageBucket: "test-bucket", StorageRegion: "us-east-1"}
	svc := user.NewService(store, c, bus, cfg, logger.New("test"))
	ctx := context.Background()

	insertTestUser(t, store, "00000000-0000-0000-0000-000000000045", "fbncache@example.com", "4000000006", "FBNCache", "offline")
	require.NoError(t, c.Set(ctx, cache.UserStatusKey("00000000-0000-0000-0000-000000000045"), "busy", time.Minute))

	profile, err := svc.FindByUniqueNumber(ctx, "4000000006")
	require.NoError(t, err)
	assert.Equal(t, "busy", profile.Status, "cache must win over the DB's offline value")
}

func TestFindByUniqueNumber_NotFound_ReturnsNotFoundError(t *testing.T) {
	svc, _ := newTestService(t)
	_, err := svc.FindByUniqueNumber(context.Background(), "9999999998")
	require.Error(t, err)
}

func TestSearchByName_ReturnsPaginatedResults(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000041", "caller2@example.com", "4000000002", "Caller2", "online")
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000042", "s1@example.com", "4000000003", "SearchTarget One", "online")
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000043", "s2@example.com", "4000000004", "SearchTarget Two", "online")

	result, err := svc.SearchByName(ctx, "SearchTarget", "00000000-0000-0000-0000-000000000041", 1, 20)
	require.NoError(t, err)
	assert.Equal(t, 2, result.Total)
	assert.Len(t, result.Users, 2)
	assert.Equal(t, 1, result.Page)
	assert.Equal(t, 20, result.Limit)
}

// TestSearchByName_NeverIncludesCaller pins the same "no self-match" rule
// store_test.go's TestSearchByName_NeverReturnsCaller pins at the Store
// layer -- repeated here at the Service layer since SearchByName is also
// where the `%query%` wildcarding happens, a step the Store-layer test
// bypasses by passing an already-wildcarded pattern directly.
func TestSearchByName_NeverIncludesCaller(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000044", "selfonly@example.com", "4000000005", "SelfOnlyMatch", "online")

	result, err := svc.SearchByName(ctx, "SelfOnlyMatch", "00000000-0000-0000-0000-000000000044", 1, 20)
	require.NoError(t, err)
	assert.Empty(t, result.Users)
	assert.Equal(t, 0, result.Total)
}

//go:build integration

package user_test

import (
	"context"
	"testing"

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

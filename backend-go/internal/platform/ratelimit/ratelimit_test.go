//go:build integration

package ratelimit_test

import (
	"context"
	"strings"
	"testing"

	"nexus-connect/backend-go/internal/platform/cache"
	"nexus-connect/backend-go/internal/platform/ratelimit"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
)

// startCache strips the "redis://" scheme from testcontainers' ConnectionString —
// see backend-go/internal/platform/cache/cache_test.go's startRedis for why.
func startCache(t *testing.T) *cache.Cache {
	t.Helper()
	ctx := context.Background()
	container, err := tcredis.Run(ctx, "redis:7-alpine")
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })
	connStr, err := container.ConnectionString(ctx)
	require.NoError(t, err)
	return cache.New(strings.TrimPrefix(connStr, "redis://"), "", 0)
}

func TestCheck_AllowsUpToLimit(t *testing.T) {
	c := startCache(t)
	limiter := ratelimit.New(c, 60_000, 3, "test")
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		res, err := limiter.Check(ctx, "user-1")
		require.NoError(t, err)
		assert.True(t, res.Allowed, "request %d should be allowed", i+1)
	}
}

func TestCheck_DeniesOverLimit(t *testing.T) {
	c := startCache(t)
	limiter := ratelimit.New(c, 60_000, 2, "test")
	ctx := context.Background()

	_, _ = limiter.Check(ctx, "user-2")
	_, _ = limiter.Check(ctx, "user-2")
	res, err := limiter.Check(ctx, "user-2")
	require.NoError(t, err)
	assert.False(t, res.Allowed)
	assert.Greater(t, res.RetryAfterSeconds, 0)
}

func TestCheck_IdentifiersAreIndependent(t *testing.T) {
	c := startCache(t)
	limiter := ratelimit.New(c, 60_000, 1, "test")
	ctx := context.Background()

	res1, _ := limiter.Check(ctx, "user-a")
	res2, _ := limiter.Check(ctx, "user-b")
	assert.True(t, res1.Allowed)
	assert.True(t, res2.Allowed, "different identifiers must not share a bucket")
}

func TestNewLoginLimiter_HasExpectedWindow(t *testing.T) {
	c := startCache(t)
	limiter := ratelimit.NewLoginLimiter(c)
	ctx := context.Background()

	var lastAllowed bool
	for i := 0; i < 11; i++ {
		res, err := limiter.Check(ctx, "login-user")
		require.NoError(t, err)
		lastAllowed = res.Allowed
	}
	assert.False(t, lastAllowed, "11th login attempt within the hour must be denied (max=10)")
}

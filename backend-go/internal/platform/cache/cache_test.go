//go:build integration

package cache_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"nexus-connect/backend-go/internal/platform/cache"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
)

// startRedis returns a bare "host:port" address. testcontainers' ConnectionString
// returns a full "redis://host:port" URI, but cache.New's addr parameter feeds
// directly into redis.Options.Addr, which expects a bare address (matching the
// bare "host:port" contract of config.Config.RedisAddr() from Task 5) — so the
// scheme must be stripped here, not inside cache.New.
func startRedis(t *testing.T) string {
	t.Helper()
	ctx := context.Background()

	container, err := tcredis.Run(ctx, "redis:7-alpine")
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	connStr, err := container.ConnectionString(ctx)
	require.NoError(t, err)
	return strings.TrimPrefix(connStr, "redis://")
}

func TestSetGet_RoundTrips(t *testing.T) {
	addr := startRedis(t)
	c := cache.New(addr, "", 0)
	defer c.Close()
	ctx := context.Background()

	require.NoError(t, c.Set(ctx, "foo", "bar", time.Minute))
	val, err := c.Get(ctx, "foo")
	require.NoError(t, err)
	assert.Equal(t, "bar", val)
}

func TestGet_MissingKeyReturnsErrNotFound(t *testing.T) {
	addr := startRedis(t)
	c := cache.New(addr, "", 0)
	defer c.Close()

	_, err := c.Get(context.Background(), "does-not-exist")
	assert.ErrorIs(t, err, cache.ErrNotFound)
}

func TestGetDel_ReturnsValueAndDeletesInOneStep(t *testing.T) {
	addr := startRedis(t)
	c := cache.New(addr, "", 0)
	defer c.Close()
	ctx := context.Background()

	require.NoError(t, c.Set(ctx, "foo", "bar", time.Minute))

	val, err := c.GetDel(ctx, "foo")
	require.NoError(t, err)
	assert.Equal(t, "bar", val)

	_, err = c.Get(ctx, "foo")
	assert.ErrorIs(t, err, cache.ErrNotFound, "GetDel must delete the key, not just read it")
}

func TestGetDel_MissingKeyReturnsErrNotFound(t *testing.T) {
	addr := startRedis(t)
	c := cache.New(addr, "", 0)
	defer c.Close()

	_, err := c.GetDel(context.Background(), "does-not-exist")
	assert.ErrorIs(t, err, cache.ErrNotFound)
}

func TestEval_SlidingWindowScriptPattern(t *testing.T) {
	addr := startRedis(t)
	c := cache.New(addr, "", 0)
	defer c.Close()
	ctx := context.Background()

	script := `
		redis.call('SET', KEYS[1], ARGV[1])
		return redis.call('GET', KEYS[1])
	`
	result, err := c.Eval(ctx, script, []string{"eval-test-key"}, "eval-value")
	require.NoError(t, err)
	assert.Equal(t, "eval-value", result)
}

func TestHealthCheck_Succeeds(t *testing.T) {
	addr := startRedis(t)
	c := cache.New(addr, "", 0)
	defer c.Close()
	assert.NoError(t, c.HealthCheck(context.Background()))
}

func TestKeys_MatchExpectedFormat(t *testing.T) {
	assert.Equal(t, "refresh:abc123", cache.RefreshTokenKey("abc123"))
	assert.Equal(t, "status:user-1", cache.UserStatusKey("user-1"))
	assert.Equal(t, "ratelimit:login:1.2.3.4", cache.RateLimitKey("1.2.3.4", "login"))
	assert.Equal(t, "typing:chat-1:user-1", cache.TypingIndicatorKey("chat-1", "user-1"))
	assert.Equal(t, "password_reset_verified:user@example.com", cache.PasswordResetVerifiedKey("user@example.com"))
}

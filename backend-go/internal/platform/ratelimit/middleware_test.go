//go:build integration

package ratelimit_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"nexus-connect/backend-go/internal/platform/auth"
	"nexus-connect/backend-go/internal/platform/cache"
	"nexus-connect/backend-go/internal/platform/ratelimit"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
)

func startCacheForMiddleware(t *testing.T) *cache.Cache {
	t.Helper()
	ctx := context.Background()
	container, err := tcredis.Run(ctx, "redis:7-alpine")
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })
	connStr, err := container.ConnectionString(ctx)
	require.NoError(t, err)
	return cache.New(strings.TrimPrefix(connStr, "redis://"), "", 0)
}

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

func TestMiddleware_AllowsUpToLimitThenRejects(t *testing.T) {
	c := startCacheForMiddleware(t)
	limiter := ratelimit.New(c, 60_000, 2, "mw-test")
	handler := ratelimit.Middleware(limiter, "production")(okHandler())

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		req.RemoteAddr = "1.2.3.4:5555"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code, "request %d should be allowed", i+1)
	}

	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.RemoteAddr = "1.2.3.4:5555"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusTooManyRequests, rec.Code)
	assert.NotEmpty(t, rec.Header().Get("Retry-After"))
}

func TestMiddleware_SkipsEntirelyInDevelopment(t *testing.T) {
	c := startCacheForMiddleware(t)
	limiter := ratelimit.New(c, 60_000, 1, "mw-dev-test")
	handler := ratelimit.Middleware(limiter, "development")(okHandler())

	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		req.RemoteAddr = "1.2.3.4:5555"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code, "request %d must not be rate limited in development", i+1)
	}
}

func TestMiddleware_SetsRateLimitHeadersOnAllowedRequest(t *testing.T) {
	c := startCacheForMiddleware(t)
	limiter := ratelimit.New(c, 60_000, 5, "mw-headers-test")
	handler := ratelimit.Middleware(limiter, "production")(okHandler())

	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.RemoteAddr = "1.2.3.4:5555"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	remaining, err := strconv.Atoi(rec.Header().Get("X-RateLimit-Remaining"))
	require.NoError(t, err)
	assert.Equal(t, 4, remaining)
	assert.NotEmpty(t, rec.Header().Get("X-RateLimit-Reset"))
}

func TestMiddleware_PrefersAuthenticatedUserIDOverIP(t *testing.T) {
	c := startCacheForMiddleware(t)
	limiter := ratelimit.New(c, 60_000, 1, "mw-identity-test")
	handler := ratelimit.Middleware(limiter, "production")(okHandler())

	// Same IP, but two different authenticated users: each gets their own budget.
	for _, userID := range []string{"user-a", "user-b"} {
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		req.RemoteAddr = "9.9.9.9:1111"
		req = req.WithContext(withFakeUser(req.Context(), userID))
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code, "user %q should get its own budget despite sharing an IP", userID)
	}
}

func withFakeUser(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, auth.UserContextKey, auth.TokenPayload{UserID: userID})
}

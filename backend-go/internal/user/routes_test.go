//go:build integration

package user_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	platformauth "nexus-connect/backend-go/internal/platform/auth"
	"nexus-connect/backend-go/internal/platform/config"
	"nexus-connect/backend-go/internal/platform/httpserver"
	"nexus-connect/backend-go/internal/platform/logger"
	"nexus-connect/backend-go/internal/user"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func validTestToken(t *testing.T, secret string) string {
	t.Helper()
	return validTestTokenFor(t, secret, "00000000-0000-0000-0000-000000000099")
}

func validTestTokenFor(t *testing.T, secret, userID string) string {
	t.Helper()
	token, err := platformauth.GenerateAccessToken(platformauth.TokenPayload{UserID: userID}, secret, time.Hour)
	require.NoError(t, err)
	return token
}

func TestRegisterRoutes_MountsAllNineEndpoints(t *testing.T) {
	svc, store := newTestService(t)
	h := user.NewHandler(svc, logger.New("test"))
	mux := httpserver.NewRouter(logger.New("test"), []string{"*"})
	cfg := config.Config{JWTAccessSecret: "test-secret-32-characters-long!"}

	// Three of the nine routes (Me, GetByID, SearchByNumber) look up a
	// specific user and return a genuine, JSON-shaped 404 "User not
	// found" business error when that user doesn't exist -- identical in
	// status code to chi's own routing-miss 404, so a bare "not 404"
	// assertion can't tell "unmounted" from "mounted but no such user"
	// unless the IDs/numbers the table uses actually exist. Asserting
	// the exact expected status per row (rather than just != 404) also
	// means a future regression to a hard 500 on any row fails loudly
	// here instead of passing silently.
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000099", "caller99@example.com", "9999999999", "Caller99", "online")
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000001", "target1@example.com", "1234567890", "Target1", "online")

	user.RegisterRoutes(mux, h, logger.New("test"), cfg)

	token := validTestToken(t, cfg.JWTAccessSecret)
	for _, tc := range []struct {
		method, path string
		wantStatus   int
	}{
		{http.MethodGet, "/api/v1/users/me", http.StatusOK},
		{http.MethodGet, "/api/v1/users/00000000-0000-0000-0000-000000000001", http.StatusOK},
		{http.MethodPatch, "/api/v1/users/me", http.StatusBadRequest},
		{http.MethodPatch, "/api/v1/users/me/status", http.StatusBadRequest},
		{http.MethodGet, "/api/v1/users/00000000-0000-0000-0000-000000000001/status", http.StatusOK},
		{http.MethodPost, "/api/v1/users/statuses", http.StatusBadRequest},
		{http.MethodPost, "/api/v1/users/me/avatar", http.StatusBadRequest},
		{http.MethodGet, "/api/v1/search/by-number/1234567890", http.StatusOK},
		{http.MethodGet, "/api/v1/search/users?query=x", http.StatusOK},
	} {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		assert.Equal(t, tc.wantStatus, rec.Code, "%s %s", tc.method, tc.path)
	}
}

// TestRegisterRoutes_RequiresBearerToken pins this module's one
// cross-cutting rule: every route (both groups) must 401 with no
// Authorization header at all -- unlike auth, where most routes are
// intentionally open. Covers one route from EACH group specifically,
// since r.Use(authed) is applied separately per mux.Route block (routes.go)
// -- a test that only ever hits /api/v1/users would stay green even if
// the /api/v1/search group's r.Use(authed) line were deleted entirely.
func TestRegisterRoutes_RequiresBearerToken(t *testing.T) {
	svc, _ := newTestService(t)
	h := user.NewHandler(svc, logger.New("test"))
	mux := httpserver.NewRouter(logger.New("test"), []string{"*"})
	cfg := config.Config{JWTAccessSecret: "test-secret-32-characters-long!"}

	user.RegisterRoutes(mux, h, logger.New("test"), cfg)

	for _, path := range []string{
		"/api/v1/users/me",
		"/api/v1/search/users?query=x",
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code, path)
	}
}

// TestRegisterRoutes_NoRouteIsRateLimited pins the Global Constraint that
// neither /api/v1/users nor /api/v1/search has any rate limiting, unlike
// auth's per-route limiter on mutating routes (see
// auth.TestRegisterRoutes_RefreshAndLogoutAreNotRateLimited for the same
// pattern on that sibling module). Hits one route from each group well
// past any plausible limiter budget.
func TestRegisterRoutes_NoRouteIsRateLimited(t *testing.T) {
	svc, store := newTestService(t)
	h := user.NewHandler(svc, logger.New("test"))
	mux := httpserver.NewRouter(logger.New("test"), []string{"*"})
	cfg := config.Config{JWTAccessSecret: "test-secret-32-characters-long!"}
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000098", "noratelimit@example.com", "9999999998", "NoRateLimit", "online")

	user.RegisterRoutes(mux, h, logger.New("test"), cfg)

	token := validTestTokenFor(t, cfg.JWTAccessSecret, "00000000-0000-0000-0000-000000000098")
	for i := 0; i < 20; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		require.NotEqual(t, http.StatusTooManyRequests, rec.Code, "/me attempt %d must not be rate limited", i+1)

		searchReq := httptest.NewRequest(http.MethodGet, "/api/v1/search/users?query=x", nil)
		searchReq.Header.Set("Authorization", "Bearer "+token)
		searchRec := httptest.NewRecorder()
		mux.ServeHTTP(searchRec, searchReq)
		require.NotEqual(t, http.StatusTooManyRequests, searchRec.Code, "/search/users attempt %d must not be rate limited", i+1)
	}
}

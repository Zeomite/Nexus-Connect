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
	token, err := platformauth.GenerateAccessToken(
		platformauth.TokenPayload{UserID: "00000000-0000-0000-0000-000000000099"},
		secret, time.Hour,
	)
	require.NoError(t, err)
	return token
}

func TestRegisterRoutes_MountsAllNineEndpoints(t *testing.T) {
	svc, store := newTestService(t)
	h := user.NewHandler(svc, logger.New("test"))
	mux := httpserver.NewRouter(logger.New("test"), []string{"*"})
	cfg := config.Config{JWTAccessSecret: "test-secret-32-characters-long!"}

	// Two of the nine routes (Me, GetByID, SearchByNumber) look up a
	// specific user and return a genuine, JSON-shaped 404 "User not
	// found" business error when that user doesn't exist -- identical in
	// status code to chi's own routing-miss 404, so the assertion below
	// (NotEqual 404) can't tell "unmounted" from "mounted but no such
	// user" unless the IDs/numbers the table uses actually exist.
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000099", "caller99@example.com", "9999999999", "Caller99", "online")
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000001", "target1@example.com", "1234567890", "Target1", "online")

	user.RegisterRoutes(mux, h, logger.New("test"), cfg)

	token := validTestToken(t, cfg.JWTAccessSecret)
	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/api/v1/users/me"},
		{http.MethodGet, "/api/v1/users/00000000-0000-0000-0000-000000000001"},
		{http.MethodPatch, "/api/v1/users/me"},
		{http.MethodPatch, "/api/v1/users/me/status"},
		{http.MethodGet, "/api/v1/users/00000000-0000-0000-0000-000000000001/status"},
		{http.MethodPost, "/api/v1/users/statuses"},
		{http.MethodPost, "/api/v1/users/me/avatar"},
		{http.MethodGet, "/api/v1/search/by-number/1234567890"},
		{http.MethodGet, "/api/v1/search/users?query=x"},
	} {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		assert.NotEqual(t, http.StatusNotFound, rec.Code, "expected %s %s to be mounted", tc.method, tc.path)
	}
}

// TestRegisterRoutes_RequiresBearerToken pins this module's one
// cross-cutting rule: every route (both groups) must 401 with no
// Authorization header at all -- unlike auth, where most routes are
// intentionally open.
func TestRegisterRoutes_RequiresBearerToken(t *testing.T) {
	svc, _ := newTestService(t)
	h := user.NewHandler(svc, logger.New("test"))
	mux := httpserver.NewRouter(logger.New("test"), []string{"*"})
	cfg := config.Config{JWTAccessSecret: "test-secret-32-characters-long!"}

	user.RegisterRoutes(mux, h, logger.New("test"), cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

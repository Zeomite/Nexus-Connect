//go:build integration

package auth_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"nexus-connect/backend-go/internal/auth"
	"nexus-connect/backend-go/internal/platform/config"
	"nexus-connect/backend-go/internal/platform/httpserver"
	"nexus-connect/backend-go/internal/platform/logger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRegisterRoutes_MountsAllNineEndpointsUnderAPIV1Auth(t *testing.T) {
	svc := newTestService(t)
	h := auth.NewHandler(svc, logger.New("test"))
	c := startCacheForAuth(t) // routes.go constructs its own limiters from this
	mux := httpserver.NewRouter(logger.New("test"), []string{"*"})
	cfg := config.Config{NodeEnv: "development"} // skip rate limiting for this mounting test

	auth.RegisterRoutes(mux, h, c, logger.New("test"), cfg)

	for _, path := range []string{
		"/api/v1/auth/register", "/api/v1/auth/login", "/api/v1/auth/refresh",
		"/api/v1/auth/logout", "/api/v1/auth/verify-email", "/api/v1/auth/resend-verification",
		"/api/v1/auth/forgot-password", "/api/v1/auth/verify-reset-code", "/api/v1/auth/update-password",
	} {
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(`{}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		assert.NotEqual(t, http.StatusNotFound, rec.Code, "expected %s to be mounted", path)
	}
}

// TestRegisterRoutes_LoginUsesLooserLimiterThanRegister pins Review Focus
// item 5: /login (1h/10) must not share the stricter 15min/5 limiter
// /register uses — this test drives /register to its limit with real
// requests and confirms /login, hit immediately after from the same
// identifier, is unaffected.
func TestRegisterRoutes_LoginUsesLooserLimiterThanRegister(t *testing.T) {
	svc := newTestService(t)
	h := auth.NewHandler(svc, logger.New("test"))
	c := startCacheForAuth(t)
	mux := httpserver.NewRouter(logger.New("test"), []string{"*"})
	cfg := config.Config{NodeEnv: "production"} // rate limiting enforced

	auth.RegisterRoutes(mux, h, c, logger.New("test"), cfg)

	remoteAddr := "7.7.7.7:4444"
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewBufferString(
			`{"email":"ratelimit-`+string(rune('a'+i))+`@example.com","password":"SecureP@ss123","displayName":"RL"}`,
		))
		req.Header.Set("Content-Type", "application/json")
		req.RemoteAddr = remoteAddr
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		require.NotEqual(t, http.StatusTooManyRequests, rec.Code, "register attempt %d should not yet be rate limited", i+1)
	}

	// The 6th /register from the same identifier must now be rate limited...
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewBufferString(`{}`))
	req.RemoteAddr = remoteAddr
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusTooManyRequests, rec.Code)

	// ...but /login from the same identifier must not be, since it uses a
	// separate (1h/10) limiter.
	loginReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(
		`{"email":"nobody@example.com","password":"whatever"}`,
	))
	loginReq.Header.Set("Content-Type", "application/json")
	loginReq.RemoteAddr = remoteAddr
	loginRec := httptest.NewRecorder()
	mux.ServeHTTP(loginRec, loginReq)
	assert.NotEqual(t, http.StatusTooManyRequests, loginRec.Code, "/login must have its own, separate rate-limit budget from /register")
}

//go:build integration

package user_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	platformauth "nexus-connect/backend-go/internal/platform/auth"
	"nexus-connect/backend-go/internal/platform/httpserver"
	"nexus-connect/backend-go/internal/platform/logger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func withCallerContext(r *http.Request, callerID string) context.Context {
	return context.WithValue(r.Context(), platformauth.UserContextKey, platformauth.TokenPayload{UserID: callerID})
}

func TestHandlerSearchByNumber_Found(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000080", "sbn@example.com", "8000000001", "SBN", "online")

	wrapped := httpserver.Wrap(logger.New("test"), h.SearchByNumber)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = withChiURLParams(req, map[string]string{"uniqueNumber": "8000000001"})
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "SBN", body["displayName"])
	_, hasEmail := body["email"]
	assert.False(t, hasEmail)
}

func TestHandlerSearchByNumber_WrongLength_Returns422(t *testing.T) {
	h, _ := newTestHandler(t)

	wrapped := httpserver.Wrap(logger.New("test"), h.SearchByNumber)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = withChiURLParams(req, map[string]string{"uniqueNumber": "123"})
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestHandlerSearchByNumber_NotFound_Returns404(t *testing.T) {
	h, _ := newTestHandler(t)

	wrapped := httpserver.Wrap(logger.New("test"), h.SearchByNumber)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = withChiURLParams(req, map[string]string{"uniqueNumber": "9999999997"})
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestHandlerSearchByName_ReturnsResults(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000081", "caller3@example.com", "8000000002", "Caller3", "online")
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000082", "nt1@example.com", "8000000003", "NameTargetAlpha", "online")

	wrapped := httpserver.Wrap(logger.New("test"), h.SearchByName)
	req := httptest.NewRequest(http.MethodGet, "/?query=NameTarget", nil)
	ctx := withCallerContext(req, "00000000-0000-0000-0000-000000000081")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	users, ok := body["users"].([]any)
	require.True(t, ok)
	assert.Len(t, users, 1)
}

func TestHandlerSearchByName_MissingQuery_Returns422(t *testing.T) {
	h, _ := newTestHandler(t)

	wrapped := httpserver.Wrap(logger.New("test"), h.SearchByName)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	ctx := withCallerContext(req, "00000000-0000-0000-0000-000000000099")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

// TestHandlerSearchByName_LimitOver100_Returns422 pins the pagination
// upper bound -- an unbounded limit would let a client page through the
// entire users table in one request.
func TestHandlerSearchByName_LimitOver100_Returns422(t *testing.T) {
	h, _ := newTestHandler(t)

	wrapped := httpserver.Wrap(logger.New("test"), h.SearchByName)
	req := httptest.NewRequest(http.MethodGet, "/?query=x&limit=500", nil)
	ctx := withCallerContext(req, "00000000-0000-0000-0000-000000000099")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

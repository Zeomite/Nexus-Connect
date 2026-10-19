//go:build integration

package user_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
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

// TestHandlerSearchByNumber_NonDigitTenChars_Returns422 pins that
// uniqueNumber must be ten DIGITS, matching the original's `^\d{10}$`
// (search.routes.ts) -- not go-playground's `numeric` tag, which also
// accepts a leading sign and a decimal point.
func TestHandlerSearchByNumber_NonDigitTenChars_Returns422(t *testing.T) {
	h, _ := newTestHandler(t)

	wrapped := httpserver.Wrap(logger.New("test"), h.SearchByNumber)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = withChiURLParams(req, map[string]string{"uniqueNumber": "-123456789"})
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

// TestHandlerSearchByName_QueryLengthCountsRunesNotBytes pins that the
// 100-character cap (Zod's .max(100), a JS string-length count) is a rune
// count in Go too, not a byte count -- 51 'é' characters are 51 runes but
// 102 UTF-8 bytes, so a byte-counting check would wrongly reject a query
// the original accepts.
func TestHandlerSearchByName_QueryLengthCountsRunesNotBytes(t *testing.T) {
	h, _ := newTestHandler(t)
	query := strings.Repeat("é", 51)

	wrapped := httpserver.Wrap(logger.New("test"), h.SearchByName)
	req := httptest.NewRequest(http.MethodGet, "/?query="+url.QueryEscape(query), nil)
	ctx := withCallerContext(req, "00000000-0000-0000-0000-000000000099")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestHandlerSearchByName_PageZero_Returns422(t *testing.T) {
	h, _ := newTestHandler(t)

	wrapped := httpserver.Wrap(logger.New("test"), h.SearchByName)
	req := httptest.NewRequest(http.MethodGet, "/?query=x&page=0", nil)
	ctx := withCallerContext(req, "00000000-0000-0000-0000-000000000099")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestHandlerSearchByName_NonNumericPage_Returns422(t *testing.T) {
	h, _ := newTestHandler(t)

	wrapped := httpserver.Wrap(logger.New("test"), h.SearchByName)
	req := httptest.NewRequest(http.MethodGet, "/?query=x&page=abc", nil)
	ctx := withCallerContext(req, "00000000-0000-0000-0000-000000000099")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestHandlerSearchByName_LimitZero_Returns422(t *testing.T) {
	h, _ := newTestHandler(t)

	wrapped := httpserver.Wrap(logger.New("test"), h.SearchByName)
	req := httptest.NewRequest(http.MethodGet, "/?query=x&limit=0", nil)
	ctx := withCallerContext(req, "00000000-0000-0000-0000-000000000099")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

// TestHandlerSearchByName_DefaultsAppliedToResponse pins that page/limit
// default to 1/20 (PaginationSchema's .default(1)/.default(20)) and that
// the response echoes the values actually applied, not just the request's.
func TestHandlerSearchByName_DefaultsAppliedToResponse(t *testing.T) {
	h, _ := newTestHandler(t)

	wrapped := httpserver.Wrap(logger.New("test"), h.SearchByName)
	req := httptest.NewRequest(http.MethodGet, "/?query=x", nil)
	ctx := withCallerContext(req, "00000000-0000-0000-0000-000000000099")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, float64(1), body["page"])
	assert.Equal(t, float64(20), body["limit"])
}

// TestHandlerSearchByName_ExcludesCaller pins Handler.SearchByName's own
// callerID(r) -> excludeUserID wiring specifically: the caller's display
// name is made to match the query too, so this test would pass
// identically if the handler passed "" instead of the real caller ID.
func TestHandlerSearchByName_ExcludesCaller(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000083", "excl-caller@example.com", "8000000004", "ExclusionTarget-Caller", "online")
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000084", "excl-other@example.com", "8000000005", "ExclusionTarget-Other", "online")

	wrapped := httpserver.Wrap(logger.New("test"), h.SearchByName)
	req := httptest.NewRequest(http.MethodGet, "/?query=ExclusionTarget", nil)
	ctx := withCallerContext(req, "00000000-0000-0000-0000-000000000083")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	users, ok := body["users"].([]any)
	require.True(t, ok)
	require.Len(t, users, 1)
	user := users[0].(map[string]any)
	assert.Equal(t, "ExclusionTarget-Other", user["displayName"])
}

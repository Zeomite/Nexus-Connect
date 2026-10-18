//go:build integration

package user_test

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	platformauth "nexus-connect/backend-go/internal/platform/auth"
	"nexus-connect/backend-go/internal/platform/httpserver"
	"nexus-connect/backend-go/internal/platform/logger"
	"nexus-connect/backend-go/internal/user"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestHandler(t *testing.T) (*user.Handler, *user.Store) {
	t.Helper()
	svc, store := newTestService(t)
	return user.NewHandler(svc, logger.New("test")), store
}

// doAuthedJSON wraps fn through httpserver.Wrap and attaches a TokenPayload
// for callerID to the request context, mirroring platformauth.Middleware's
// own attachment so handlers that call platformauth.FromContext(r.Context())
// see the same shape they would behind the real middleware.
func doAuthedJSON(t *testing.T, fn httpserver.HandlerFunc, method, callerID, body string, urlParams map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	wrapped := httpserver.Wrap(logger.New("test"), fn)
	req := httptest.NewRequest(method, "/", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")

	ctx := context.WithValue(req.Context(), platformauth.UserContextKey, platformauth.TokenPayload{UserID: callerID})
	req = req.WithContext(ctx)

	if len(urlParams) > 0 {
		req = withChiURLParams(req, urlParams)
	}

	rec := httptest.NewRecorder()
	wrapped(rec, req)
	return rec
}

func withChiURLParams(r *http.Request, params map[string]string) *http.Request {
	rctx := chi.NewRouteContext()
	for k, v := range params {
		rctx.URLParams.Add(k, v)
	}
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

func TestHandlerMe_ReturnsOwnProfileIncludingEmail(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000060", "handlerme@example.com", "6000000001", "HandlerMe", "online")

	rec := doAuthedJSON(t, h.Me, http.MethodGet, "00000000-0000-0000-0000-000000000060", "", nil)

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "handlerme@example.com", body["email"])
}

// TestHandlerGetByID_ResponseNeverContainsEmailKey pins Review Focus item 1
// at the wire level: not just "the struct has no Email field" (already
// pinned in service_profile_test.go) but "the actual JSON body sent to an
// HTTP client has no email key at all" -- the layer an attacker actually
// observes.
func TestHandlerGetByID_ResponseNeverContainsEmailKey(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000061", "shouldnotleak2@example.com", "6000000002", "NoLeak2", "online")

	rec := doAuthedJSON(t, h.GetByID, http.MethodGet, "00000000-0000-0000-0000-000000000099", "", map[string]string{
		"userId": "00000000-0000-0000-0000-000000000061",
	})

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	_, hasEmail := body["email"]
	assert.False(t, hasEmail, "GET /:userId must never include an email key, regardless of who's asking")
}

func TestHandlerUpdateMe_DisplayNameOnly_Returns200(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000062", "updme@example.com", "6000000003", "Old", "online")

	rec := doAuthedJSON(t, h.UpdateMe, http.MethodPatch, "00000000-0000-0000-0000-000000000062", `{"displayName":"New Name"}`, nil)

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "New Name", body["displayName"])
}

func TestHandlerUpdateMe_TooLongDisplayName_Returns422(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000063", "toolong@example.com", "6000000004", "Short", "online")

	longName := make([]byte, 101)
	for i := range longName {
		longName[i] = 'a'
	}
	reqBody, err := json.Marshal(map[string]string{"displayName": string(longName)})
	require.NoError(t, err)

	rec := doAuthedJSON(t, h.UpdateMe, http.MethodPatch, "00000000-0000-0000-0000-000000000063", string(reqBody), nil)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

// TestHandlerUpdateMe_InvalidProfilePictureURL_Returns422 pins the `url`
// format check the original's `z.string().url()` applies when the field
// is present and non-null.
func TestHandlerUpdateMe_InvalidProfilePictureURL_Returns422(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000064", "badurl@example.com", "6000000005", "BadURL", "online")

	rec := doAuthedJSON(t, h.UpdateMe, http.MethodPatch, "00000000-0000-0000-0000-000000000064", `{"profilePictureUrl":"not-a-url"}`, nil)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

// TestHandlerUpdateMe_NonHTTPSchemeProfilePictureURL_Returns422 pins a
// deliberate hardening beyond the original (see Task 4's ledger entry):
// a syntactically valid but non-http(s) scheme (javascript:, data:, etc.)
// must be rejected too, not just a malformed string.
func TestHandlerUpdateMe_NonHTTPSchemeProfilePictureURL_Returns422(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000073", "jsscheme@example.com", "6000000014", "JSScheme", "online")

	rec := doAuthedJSON(t, h.UpdateMe, http.MethodPatch, "00000000-0000-0000-0000-000000000073", `{"profilePictureUrl":"javascript:alert(1)"}`, nil)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestHandlerUpdateMyStatus_ValidStatus_Returns200(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000065", "status1@example.com", "6000000006", "Status1", "offline")

	rec := doAuthedJSON(t, h.UpdateMyStatus, http.MethodPatch, "00000000-0000-0000-0000-000000000065", `{"status":"busy"}`, nil)

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "busy", body["status"])
}

func TestHandlerUpdateMyStatus_InvalidStatus_Returns422(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000066", "status2@example.com", "6000000007", "Status2", "offline")

	rec := doAuthedJSON(t, h.UpdateMyStatus, http.MethodPatch, "00000000-0000-0000-0000-000000000066", `{"status":"not-a-real-status"}`, nil)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestHandlerGetStatusByID_ReturnsStatus(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000067", "gsbid@example.com", "6000000008", "GSBID", "away")

	rec := doAuthedJSON(t, h.GetStatusByID, http.MethodGet, "00000000-0000-0000-0000-000000000099", "", map[string]string{
		"userId": "00000000-0000-0000-0000-000000000067",
	})

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "away", body["status"])
}

func TestHandlerGetStatuses_ReturnsMapOfStatuses(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000068", "gs1@example.com", "6000000009", "GS1", "online")
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000069", "gs2@example.com", "6000000010", "GS2", "offline")

	reqBody, err := json.Marshal(map[string][]string{
		"userIds": {"00000000-0000-0000-0000-000000000068", "00000000-0000-0000-0000-000000000069"},
	})
	require.NoError(t, err)

	rec := doAuthedJSON(t, h.GetStatuses, http.MethodPost, "00000000-0000-0000-0000-000000000099", string(reqBody), nil)

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "online", body["statuses"]["00000000-0000-0000-0000-000000000068"])
	assert.Equal(t, "offline", body["statuses"]["00000000-0000-0000-0000-000000000069"])
}

func TestHandlerUploadAvatar_ValidImage_Returns200(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000070", "uploadavatar@example.com", "6000000011", "UploadAvatar", "online")

	// multipart.Writer.CreateFormFile always sets Content-Type to
	// application/octet-stream, regardless of the filename's extension —
	// it never sniffs or infers a type. UploadAvatar's allowlist check
	// reads this header, so a real image upload must set it explicitly
	// via CreatePart, the same way TestHandlerUploadAvatar_DisallowedMimeType_Returns400
	// below already has to for its own (rejected) content type.
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreatePart(map[string][]string{
		"Content-Disposition": {`form-data; name="file"; filename="photo.png"`},
		"Content-Type":        {"image/png"},
	})
	require.NoError(t, err)
	_, err = part.Write([]byte("fake-png-bytes"))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	wrapped := httpserver.WrapWithBodyLimit(logger.New("test"), h.UploadAvatar, 5<<20)
	req := httptest.NewRequest(http.MethodPost, "/", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	ctx := context.WithValue(req.Context(), platformauth.UserContextKey, platformauth.TokenPayload{UserID: "00000000-0000-0000-0000-000000000070"})
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Contains(t, body["profilePictureUrl"], ".png")
}

// TestHandlerUploadAvatar_DisallowedMimeType_Returns400 pins Review Focus
// item 5: a disallowed type must be rejected before UploadAvatar is ever
// called, and the user's existing picture must survive untouched.
func TestHandlerUploadAvatar_DisallowedMimeType_Returns400(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000071", "badmime@example.com", "6000000012", "BadMime", "online")

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreatePart(map[string][]string{
		"Content-Disposition": {`form-data; name="file"; filename="doc.pdf"`},
		"Content-Type":        {"application/pdf"},
	})
	require.NoError(t, err)
	_, err = part.Write([]byte("%PDF-fake"))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	wrapped := httpserver.WrapWithBodyLimit(logger.New("test"), h.UploadAvatar, 5<<20)
	req := httptest.NewRequest(http.MethodPost, "/", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	ctx := context.WithValue(req.Context(), platformauth.UserContextKey, platformauth.TokenPayload{UserID: "00000000-0000-0000-0000-000000000071"})
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestHandlerUploadAvatar_NoFile_Returns400(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000072", "nofile@example.com", "6000000013", "NoFile", "online")

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	require.NoError(t, writer.Close())

	wrapped := httpserver.WrapWithBodyLimit(logger.New("test"), h.UploadAvatar, 5<<20)
	req := httptest.NewRequest(http.MethodPost, "/", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	ctx := context.WithValue(req.Context(), platformauth.UserContextKey, platformauth.TokenPayload{UserID: "00000000-0000-0000-0000-000000000072"})
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

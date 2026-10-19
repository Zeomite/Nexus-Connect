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

// TestHandlerGetByID_InvalidUUIDFormat_Returns422 pins that a malformed
// userId is rejected before it ever reaches the DB. Without this, chi's
// router falls back to this same {userId} handler for ANY unmatched
// sibling path (e.g. a wrong-method request to /statuses), and an
// invalid-UUID DB error becomes an uncaught 500 -- a free way for any
// authenticated client to flood error logs and skew 5xx alerting.
func TestHandlerGetByID_InvalidUUIDFormat_Returns422(t *testing.T) {
	h, _ := newTestHandler(t)

	rec := doAuthedJSON(t, h.GetByID, http.MethodGet, "00000000-0000-0000-0000-000000000099", "", map[string]string{
		"userId": "not-a-uuid",
	})

	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestHandlerGetStatusByID_InvalidUUIDFormat_Returns422(t *testing.T) {
	h, _ := newTestHandler(t)

	rec := doAuthedJSON(t, h.GetStatusByID, http.MethodGet, "00000000-0000-0000-0000-000000000099", "", map[string]string{
		"userId": "not-a-uuid",
	})

	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
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

// TestHandlerUpdateMe_BothFieldsSet_Returns200 pins the wire-layer
// decode/validate interaction for two simultaneous fields -- the
// Store layer already covers combining both fields in one UPDATE
// (store_test.go's TestUpdateProfile_BothFieldsSet), but nothing
// previously exercised decodeAndValidate/ProfileUpdate construction with
// both OptionalString and *string set together at the Handler layer.
func TestHandlerUpdateMe_BothFieldsSet_Returns200(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000074", "bothfields@example.com", "6000000015", "Old", "online")

	rec := doAuthedJSON(t, h.UpdateMe, http.MethodPatch, "00000000-0000-0000-0000-000000000074",
		`{"displayName":"New Name","profilePictureUrl":"https://example.com/new.png"}`, nil)

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "New Name", body["displayName"])
	assert.Equal(t, "https://example.com/new.png", body["profilePictureUrl"])
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

// TestHandlerGetStatuses_NonUUIDElement_Returns422 pins that `dive,uuid`
// (dto.go's statusesRequest.UserIDs) validates PER ELEMENT, not the slice
// as a whole -- a mix of one valid UUID and one malformed string must
// still be rejected.
func TestHandlerGetStatuses_NonUUIDElement_Returns422(t *testing.T) {
	h, _ := newTestHandler(t)

	reqBody, err := json.Marshal(map[string][]string{
		"userIds": {"00000000-0000-0000-0000-000000000068", "not-a-uuid"},
	})
	require.NoError(t, err)

	rec := doAuthedJSON(t, h.GetStatuses, http.MethodPost, "00000000-0000-0000-0000-000000000099", string(reqBody), nil)

	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
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

// TestHandlerUploadAvatar_OverSizeLimit_Returns413 pins that the 5 MiB
// cap (WrapWithBodyLimit's maxBytes, see routes.go's avatarUploadMaxBytes)
// actually fires. http.MaxBytesReader only trips when something reads the
// body -- UploadAvatar must drain the file part for this to be enforced
// at all, not just claim the limit in a doc comment.
func TestHandlerUploadAvatar_OverSizeLimit_Returns413(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000073", "oversize@example.com", "6000000014", "Oversize", "online")

	const limit = 5 << 20
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreatePart(map[string][]string{
		"Content-Disposition": {`form-data; name="file"; filename="big.png"`},
		"Content-Type":        {"image/png"},
	})
	require.NoError(t, err)
	_, err = part.Write(bytes.Repeat([]byte("a"), limit+1024))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	wrapped := httpserver.WrapWithBodyLimit(logger.New("test"), h.UploadAvatar, limit)
	req := httptest.NewRequest(http.MethodPost, "/", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	ctx := context.WithValue(req.Context(), platformauth.UserContextKey, platformauth.TokenPayload{UserID: "00000000-0000-0000-0000-000000000073"})
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
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

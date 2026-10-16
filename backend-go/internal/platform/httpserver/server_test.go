package httpserver_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	apperrors "nexus-connect/backend-go/internal/platform/errors"
	"nexus-connect/backend-go/internal/platform/httpserver"
	"nexus-connect/backend-go/internal/platform/logger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHealthEndpoint_Returns200(t *testing.T) {
	router := httpserver.NewRouter(logger.New("test"), []string{"*"})
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	var body map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "ok", body["status"])
}

func TestWrap_SuccessPassesThrough(t *testing.T) {
	log := logger.New("test")
	handler := httpserver.Wrap(log, func(w http.ResponseWriter, r *http.Request) error {
		return httpserver.WriteJSON(w, http.StatusCreated, map[string]string{"id": "123"})
	})

	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rec := httptest.NewRecorder()
	handler(rec, req)

	assert.Equal(t, http.StatusCreated, rec.Code)
}

func TestWrap_AppErrorMapsToCorrectStatusAndBody(t *testing.T) {
	log := logger.New("test")
	handler := httpserver.Wrap(log, func(w http.ResponseWriter, r *http.Request) error {
		return apperrors.NotFound("Chat")
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	handler(rec, req)

	assert.Equal(t, http.StatusNotFound, rec.Code)
	var body map[string]map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "NOT_FOUND", body["error"]["code"])
	assert.Equal(t, "Chat not found", body["error"]["message"])
}

func TestWrap_PlainErrorMapsTo500(t *testing.T) {
	log := logger.New("test")
	handler := httpserver.Wrap(log, func(w http.ResponseWriter, r *http.Request) error {
		return assertAnError()
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	handler(rec, req)

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	var body map[string]map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "INTERNAL_ERROR", body["error"]["code"])
}

// TestWrap_PlainErrorDoesNotLeakRawErrorTextToClient guards against sending
// an unhandled error's raw .Error() text to the client — that can leak
// internal details (DB DSNs, file paths, driver messages). The original TS
// error handler (auth-service/src/server.ts) logs the real error server-side
// but always sends a generic client-facing message; the Go port must match.
func TestWrap_PlainErrorDoesNotLeakRawErrorTextToClient(t *testing.T) {
	log := logger.New("test")
	handler := httpserver.Wrap(log, func(w http.ResponseWriter, r *http.Request) error {
		return fmt.Errorf("pq: connection failed to postgres://admin:s3cr3t@10.0.0.5:5432/prod")
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	handler(rec, req)

	var body map[string]map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	message, _ := body["error"]["message"].(string)
	assert.NotContains(t, message, "s3cr3t")
	assert.NotContains(t, message, "10.0.0.5")
	assert.Equal(t, "Internal server error", message)
}

func TestRouter_SetsSecurityHeaders(t *testing.T) {
	router := httpserver.NewRouter(logger.New("test"), []string{"*"})
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	assert.Equal(t, "nosniff", rec.Header().Get("X-Content-Type-Options"))
	assert.Equal(t, "SAMEORIGIN", rec.Header().Get("X-Frame-Options"))
}

func TestRouter_RecoversFromPanicInHandler(t *testing.T) {
	router := httpserver.NewRouter(logger.New("test"), []string{"*"})
	router.Get("/panics", func(w http.ResponseWriter, r *http.Request) {
		panic("boom")
	})

	req := httptest.NewRequest(http.MethodGet, "/panics", nil)
	rec := httptest.NewRecorder()

	assert.NotPanics(t, func() {
		router.ServeHTTP(rec, req)
	})
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
}

// TestRecoverer_PanicResponseOmitsDetailsKey guards the panic-recovery path's
// JSON body against drifting from Task 2's AppError wire contract: Details
// must be an absent key when nil, never a literal "details":null — the two
// are different wire shapes, and the TS original's JSON.stringify always
// drops the undefined key.
func TestRecoverer_PanicResponseOmitsDetailsKey(t *testing.T) {
	router := httpserver.NewRouter(logger.New("test"), []string{"*"})
	router.Get("/panics", func(w http.ResponseWriter, r *http.Request) {
		panic("boom")
	})

	req := httptest.NewRequest(http.MethodGet, "/panics", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	var body map[string]map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	_, hasDetails := body["error"]["details"]
	assert.False(t, hasDetails, "details key must be omitted, not emitted as null")
}

// TestRecoverer_PanicAfterResponseAlreadyStartedDoesNotCorruptIt covers a
// handler that panics after it already wrote a (partial) response. The
// recoverer must not attempt a second WriteHeader/body on top of one
// already in flight — that would corrupt whatever the client receives.
func TestRecoverer_PanicAfterResponseAlreadyStartedDoesNotCorruptIt(t *testing.T) {
	router := httpserver.NewRouter(logger.New("test"), []string{"*"})
	router.Get("/panics-after-write", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("partial"))
		panic("boom")
	})

	req := httptest.NewRequest(http.MethodGet, "/panics-after-write", nil)
	rec := httptest.NewRecorder()

	assert.NotPanics(t, func() {
		router.ServeHTTP(rec, req)
	})
	assert.Equal(t, http.StatusOK, rec.Code, "the original response status must not be overwritten")
	assert.Equal(t, "partial", rec.Body.String())
}

// TestWrap_ErrorAfterResponseAlreadyStartedDoesNotCorruptIt covers the
// mirror case for Wrap: a handler returning WriteJSON's own result (the
// documented convention) can have its header succeed but body-encode fail,
// returning a non-nil error from an already-started response. Wrap must not
// then try to write a second, different status/body on top of it.
func TestWrap_ErrorAfterResponseAlreadyStartedDoesNotCorruptIt(t *testing.T) {
	log := logger.New("test")
	handler := httpserver.Wrap(log, func(w http.ResponseWriter, r *http.Request) error {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("partial"))
		return assertAnError()
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	handler(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code, "the original response status must not be overwritten")
	assert.Equal(t, "partial", rec.Body.String())
}

func assertAnError() error {
	return &plainErr{}
}

type plainErr struct{}

func (p *plainErr) Error() string { return "boom" }

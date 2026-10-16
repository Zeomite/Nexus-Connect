//go:build integration

package auth_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"nexus-connect/backend-go/internal/auth"
	"nexus-connect/backend-go/internal/platform/httpserver"
	"nexus-connect/backend-go/internal/platform/logger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestHandler(t *testing.T) *auth.Handler {
	t.Helper()
	svc := newTestService(t)
	return auth.NewHandler(svc, logger.New("test"))
}

func doJSON(t *testing.T, fn httpserver.HandlerFunc, method, body string) *httptest.ResponseRecorder {
	t.Helper()
	wrapped := httpserver.Wrap(logger.New("test"), fn)
	req := httptest.NewRequest(method, "/", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	wrapped(rec, req)
	return rec
}

func TestHandlerRegister_ValidBody_Returns201(t *testing.T) {
	h := newTestHandler(t)
	rec := doJSON(t, h.Register, http.MethodPost, `{"email":"handler-reg@example.com","password":"SecureP@ss123","displayName":"Handler Reg"}`)

	require.Equal(t, http.StatusCreated, rec.Code)
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.NotEmpty(t, body["userId"])
	assert.Len(t, body["uniqueNumber"], 10)
}

func TestHandlerRegister_MissingDisplayName_Returns422(t *testing.T) {
	h := newTestHandler(t)
	rec := doJSON(t, h.Register, http.MethodPost, `{"email":"missing-name@example.com","password":"SecureP@ss123"}`)

	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestHandlerRegister_ShortPassword_Returns422(t *testing.T) {
	h := newTestHandler(t)
	rec := doJSON(t, h.Register, http.MethodPost, `{"email":"short-pw@example.com","password":"short","displayName":"Short"}`)

	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestHandlerRegister_MalformedJSON_Returns400(t *testing.T) {
	h := newTestHandler(t)
	rec := doJSON(t, h.Register, http.MethodPost, `{not-json`)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestHandlerRegister_DuplicateEmail_Returns409(t *testing.T) {
	h := newTestHandler(t)
	body := `{"email":"handler-dup@example.com","password":"SecureP@ss123","displayName":"Dup"}`
	first := doJSON(t, h.Register, http.MethodPost, body)
	require.Equal(t, http.StatusCreated, first.Code)

	second := doJSON(t, h.Register, http.MethodPost, body)
	assert.Equal(t, http.StatusConflict, second.Code)
}

func TestHandlerLogin_WeakPasswordFieldHasNoLengthLimitOnLogin(t *testing.T) {
	// Login's password field must accept any non-empty string — the original
	// never applies a min/max length check on login (you're checking an
	// existing hash, not creating a new password). A single-character
	// password must fail with INVALID_CREDENTIALS (wrong password), not 422
	// (validation).
	h := newTestHandler(t)
	rec := doJSON(t, h.Login, http.MethodPost, `{"email":"nobody@example.com","password":"x"}`)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestHandlerLogin_MissingEmail_Returns422(t *testing.T) {
	h := newTestHandler(t)
	rec := doJSON(t, h.Login, http.MethodPost, `{"password":"whatever"}`)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestHandlerVerifyEmail_WrongLengthCode_Returns422(t *testing.T) {
	h := newTestHandler(t)
	rec := doJSON(t, h.VerifyEmail, http.MethodPost, `{"email":"a@example.com","code":"123"}`)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestHandlerUpdatePassword_NoMaxLengthOnPassword(t *testing.T) {
	// Pins the deliberate asymmetry documented in this plan's Global
	// Constraints: update-password has no upper bound on password length,
	// unlike register. A 200-character password must pass validation (and
	// then fail downstream with TOKEN_EXPIRED, since no reset was actually
	// requested — not 422).
	h := newTestHandler(t)
	longPassword := make([]byte, 200)
	for i := range longPassword {
		longPassword[i] = 'a'
	}
	reqBody, err := json.Marshal(map[string]string{
		"email": "a@example.com", "resetToken": "token", "password": string(longPassword),
	})
	require.NoError(t, err)

	rec := doJSON(t, h.UpdatePassword, http.MethodPost, string(reqBody))
	assert.Equal(t, http.StatusUnauthorized, rec.Code, "must fail with TOKEN_EXPIRED's 401, not a validation 422")
}

func TestHandlerForgotPassword_AlwaysReturns200WithGenericMessage(t *testing.T) {
	h := newTestHandler(t)
	rec := doJSON(t, h.ForgotPassword, http.MethodPost, `{"email":"ghost-handler@example.com"}`)

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "If the email exists, a password reset link has been sent", body["message"])
}

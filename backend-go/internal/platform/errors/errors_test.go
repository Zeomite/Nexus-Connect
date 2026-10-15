package errors_test

import (
	"encoding/json"
	"testing"

	apperrors "nexus-connect/backend-go/internal/platform/errors"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNotFound_StatusAndCode(t *testing.T) {
	err := apperrors.NotFound("Chat")
	assert.Equal(t, 404, err.StatusCode)
	assert.Equal(t, "NOT_FOUND", err.Code)
	assert.Equal(t, "Chat not found", err.Message)
}

func TestAppError_MarshalJSON_Shape(t *testing.T) {
	err := apperrors.Validation("Validation failed", map[string]any{"email": "invalid"})
	b, marshalErr := json.Marshal(err)
	require.NoError(t, marshalErr)

	var decoded map[string]map[string]any
	require.NoError(t, json.Unmarshal(b, &decoded))

	inner, ok := decoded["error"]
	require.True(t, ok, "expected top-level \"error\" key")
	assert.Equal(t, "VALIDATION_ERROR", inner["code"])
	assert.Equal(t, "Validation failed", inner["message"])
	assert.Equal(t, map[string]any{"email": "invalid"}, inner["details"])
}

func TestDuplicateEmail(t *testing.T) {
	err := apperrors.DuplicateEmail()
	assert.Equal(t, 409, err.StatusCode)
	assert.Equal(t, "DUPLICATE_EMAIL", err.Code)
}

func TestRateLimit_CarriesRetryAfter(t *testing.T) {
	err := apperrors.RateLimit(42)
	assert.Equal(t, 429, err.StatusCode)
	assert.Equal(t, 42, err.Details["retryAfter"])
}

func TestAs_UnwrapsAppError(t *testing.T) {
	var err error = apperrors.Forbidden("nope")
	got, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "FORBIDDEN", got.Code)
}

func TestAs_FalseForPlainError(t *testing.T) {
	_, ok := apperrors.As(assertAnError())
	assert.False(t, ok)
}

func assertAnError() error {
	return &plainErr{}
}

type plainErr struct{}

func (p *plainErr) Error() string { return "plain" }

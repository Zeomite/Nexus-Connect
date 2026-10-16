package validate_test

import (
	"testing"

	apperrors "nexus-connect/backend-go/internal/platform/errors"
	"nexus-connect/backend-go/internal/platform/validate"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Password carries min=8,max=128 alongside password_strength: the custom
// tag only checks character-class composition (upper/lower/digit/special),
// mirroring validators.ts's PasswordStrengthSchema, which chains its own
// separate .min(8)/.max(128) checks before the character-class .refine()
// calls — the length bound isn't duplicated inside passwordStrength itself.
type registerInput struct {
	Email       string `validate:"required,email"`
	Password    string `validate:"required,min=8,max=128,password_strength"`
	DisplayName string `validate:"required,min=1,max=100"`
}

func TestStruct_ValidInputReturnsNil(t *testing.T) {
	input := registerInput{Email: "a@example.com", Password: "SecureP@ss123", DisplayName: "John"}
	assert.NoError(t, validate.Struct(input))
}

func TestStruct_MissingRequiredFieldReturnsValidationError(t *testing.T) {
	input := registerInput{Email: "", Password: "SecureP@ss123", DisplayName: "John"}
	err := validate.Struct(input)
	require.Error(t, err)

	appErr, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "VALIDATION_ERROR", appErr.Code)
	assert.Contains(t, appErr.Details, "Email")
}

func TestStruct_InvalidEmailFormat(t *testing.T) {
	input := registerInput{Email: "not-an-email", Password: "SecureP@ss123", DisplayName: "John"}
	err := validate.Struct(input)
	require.Error(t, err)
}

func TestStruct_PasswordStrength_RejectsNoSpecialChar(t *testing.T) {
	input := registerInput{Email: "a@example.com", Password: "NoSpecialChar123", DisplayName: "John"}
	err := validate.Struct(input)
	require.Error(t, err)
	appErr, _ := apperrors.As(err)
	assert.Contains(t, appErr.Details, "Password")
}

func TestStruct_PasswordStrength_RejectsTooShort(t *testing.T) {
	input := registerInput{Email: "a@example.com", Password: "Sh0rt!", DisplayName: "John"}
	assert.Error(t, validate.Struct(input))
}

func TestStruct_PasswordStrength_AcceptsValidPassword(t *testing.T) {
	input := registerInput{Email: "a@example.com", Password: "V4lid!Pass", DisplayName: "John"}
	assert.NoError(t, validate.Struct(input))
}

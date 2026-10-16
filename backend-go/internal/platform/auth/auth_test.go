package auth_test

import (
	"testing"
	"time"

	"nexus-connect/backend-go/internal/platform/auth"
	apperrors "nexus-connect/backend-go/internal/platform/errors"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHashAndComparePassword_RoundTrips(t *testing.T) {
	hash, err := auth.HashPassword("SecureP@ss123!")
	require.NoError(t, err)
	assert.NotEqual(t, "SecureP@ss123!", hash)
	assert.True(t, auth.ComparePassword("SecureP@ss123!", hash))
	assert.False(t, auth.ComparePassword("wrong-password", hash))
}

func TestGenerateAndVerifyAccessToken_RoundTrips(t *testing.T) {
	payload := auth.TokenPayload{UserID: "u-1", Email: "a@example.com", UniqueNumber: "1234567890"}
	token, err := auth.GenerateAccessToken(payload, "test-secret-32-characters-min!!", time.Minute)
	require.NoError(t, err)

	got, err := auth.VerifyToken(token, "test-secret-32-characters-min!!")
	require.NoError(t, err)
	assert.Equal(t, payload, got)
}

// TestGenerateRefreshToken_SameInputsWithinSameSecond_ProducesDistinctTokens
// pins a real single-use-rotation bug this test caught: jwt.RegisteredClaims
// timestamps (iat/exp) are second-granularity, so two tokens signed for the
// same payload within the same wall-clock second were previously
// byte-for-byte identical (same header, same claims, same HMAC signature).
// Callers that key a store by the token string (RefreshTokens's Redis entry,
// keyed by cache.RefreshTokenKey(token)) rely on each issued token being
// unique: a collision silently resurrects an already-rotated-out token under
// its own key, defeating single-use. A random jti makes every token distinct
// regardless of timing, independent of any other claim.
func TestGenerateRefreshToken_SameInputsWithinSameSecond_ProducesDistinctTokens(t *testing.T) {
	payload := auth.TokenPayload{UserID: "u-1", Email: "a@example.com", UniqueNumber: "1234567890"}

	first, err := auth.GenerateRefreshToken(payload, "test-secret-32-characters-min!!", time.Hour)
	require.NoError(t, err)
	second, err := auth.GenerateRefreshToken(payload, "test-secret-32-characters-min!!", time.Hour)
	require.NoError(t, err)

	assert.NotEqual(t, first, second)
}

func TestVerifyToken_ExpiredReturnsTokenExpiredError(t *testing.T) {
	payload := auth.TokenPayload{UserID: "u-1", Email: "a@example.com", UniqueNumber: "1234567890"}
	token, err := auth.GenerateAccessToken(payload, "test-secret-32-characters-min!!", -time.Minute) // already expired
	require.NoError(t, err)

	_, err = auth.VerifyToken(token, "test-secret-32-characters-min!!")
	require.Error(t, err)
	appErr, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "TOKEN_EXPIRED", appErr.Code)
}

func TestVerifyToken_WrongSecretReturnsInvalidTokenError(t *testing.T) {
	payload := auth.TokenPayload{UserID: "u-1", Email: "a@example.com", UniqueNumber: "1234567890"}
	token, err := auth.GenerateAccessToken(payload, "secret-one-32-characters-long!!!", time.Minute)
	require.NoError(t, err)

	_, err = auth.VerifyToken(token, "secret-two-32-characters-long!!!")
	require.Error(t, err)
	appErr, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "INVALID_TOKEN", appErr.Code)
}

func TestVerifyToken_MalformedTokenReturnsInvalidTokenError(t *testing.T) {
	_, err := auth.VerifyToken("not-a-jwt-at-all", "any-secret")
	require.Error(t, err)
	appErr, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "INVALID_TOKEN", appErr.Code)
}

// TestVerifyToken_RejectsNoneAlgorithm guards against the classic JWT "alg:
// none" downgrade attack: a token whose header claims no signature is
// required at all. golang-jwt already refuses this unless the keyfunc
// explicitly opts in via jwt.UnsafeAllowNoneSignatureType (which this
// package's keyfunc never returns), so this is a regression test for that
// built-in protection, not proof of a bug this task fixes.
func TestVerifyToken_RejectsNoneAlgorithm(t *testing.T) {
	token := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.MapClaims{
		"userId": "attacker",
		"email":  "attacker@example.com",
		"exp":    time.Now().Add(time.Hour).Unix(),
	})
	tokenString, err := token.SignedString(jwt.UnsafeAllowNoneSignatureType)
	require.NoError(t, err)

	_, err = auth.VerifyToken(tokenString, "any-secret")
	require.Error(t, err)
	appErr, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "INVALID_TOKEN", appErr.Code)
}

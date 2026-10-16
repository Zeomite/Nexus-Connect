//go:build integration

package auth_test

import (
	"context"
	"testing"

	"nexus-connect/backend-go/internal/auth"
	apperrors "nexus-connect/backend-go/internal/platform/errors"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func registerAndVerify(t *testing.T, svc *auth.Service, email, password, displayName string) {
	t.Helper()
	ctx := context.Background()
	_, err := svc.Register(ctx, auth.RegisterInput{Email: email, Password: password, DisplayName: displayName})
	require.NoError(t, err)
	code, err := svc.PeekVerificationCodeForTest(ctx, email)
	require.NoError(t, err)
	require.NoError(t, svc.VerifyEmail(ctx, email, code))
}

func TestLogin_VerifiedUserCorrectPassword_Succeeds(t *testing.T) {
	svc := newTestService(t)
	registerAndVerify(t, svc, "login-ok@example.com", "SecureP@ss123", "Login OK")

	result, err := svc.Login(context.Background(), auth.LoginInput{Email: "login-ok@example.com", Password: "SecureP@ss123"})
	require.NoError(t, err)
	assert.NotEmpty(t, result.AccessToken)
	assert.NotEmpty(t, result.RefreshToken)
	assert.Greater(t, result.ExpiresIn, int64(0))
	assert.Equal(t, "login-ok@example.com", result.User.Email)
	assert.Equal(t, "Login OK", result.User.DisplayName)
}

func TestLogin_WrongPassword_ReturnsInvalidCredentials(t *testing.T) {
	svc := newTestService(t)
	registerAndVerify(t, svc, "wrong-pw@example.com", "SecureP@ss123", "WrongPw")

	_, err := svc.Login(context.Background(), auth.LoginInput{Email: "wrong-pw@example.com", Password: "WrongOne!23"})
	require.Error(t, err)
	appErr, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "INVALID_CREDENTIALS", appErr.Code)
}

func TestLogin_NonExistentEmail_ReturnsInvalidCredentials(t *testing.T) {
	svc := newTestService(t)
	_, err := svc.Login(context.Background(), auth.LoginInput{Email: "ghost@example.com", Password: "Whatever123!"})
	require.Error(t, err)
	appErr, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "INVALID_CREDENTIALS", appErr.Code)
}

// TestLogin_UnverifiedEmail_ReturnsEmailNotVerified_NotInvalidCredentials
// pins Review Focus item 1: a correct password for an unverified account
// must fail with 403 EMAIL_NOT_VERIFIED, never 401 INVALID_CREDENTIALS —
// the two checks (password correctness, then verification status) must run
// in that order and must not be conflated into one.
func TestLogin_UnverifiedEmail_ReturnsEmailNotVerified_NotInvalidCredentials(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()
	_, err := svc.Register(ctx, auth.RegisterInput{
		Email: "unverified-login@example.com", Password: "SecureP@ss123", DisplayName: "Unverified",
	})
	require.NoError(t, err)

	_, err = svc.Login(ctx, auth.LoginInput{Email: "unverified-login@example.com", Password: "SecureP@ss123"})
	require.Error(t, err)
	appErr, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "EMAIL_NOT_VERIFIED", appErr.Code)
}

func TestRefreshTokens_ValidToken_IssuesNewPair(t *testing.T) {
	svc := newTestService(t)
	registerAndVerify(t, svc, "refresh-ok@example.com", "SecureP@ss123", "RefreshOK")
	ctx := context.Background()

	login, err := svc.Login(ctx, auth.LoginInput{Email: "refresh-ok@example.com", Password: "SecureP@ss123"})
	require.NoError(t, err)

	refreshed, err := svc.RefreshTokens(ctx, login.RefreshToken)
	require.NoError(t, err)
	assert.NotEmpty(t, refreshed.AccessToken)
	assert.NotEmpty(t, refreshed.RefreshToken)
	assert.NotEqual(t, login.RefreshToken, refreshed.RefreshToken)
}

// TestRefreshTokens_TokenIsSingleUse pins Review Focus item 4: using the
// same refresh token twice must fail the second time, since the first call
// deletes it from Redis before issuing a replacement.
func TestRefreshTokens_TokenIsSingleUse(t *testing.T) {
	svc := newTestService(t)
	registerAndVerify(t, svc, "single-use@example.com", "SecureP@ss123", "SingleUse")
	ctx := context.Background()

	login, err := svc.Login(ctx, auth.LoginInput{Email: "single-use@example.com", Password: "SecureP@ss123"})
	require.NoError(t, err)

	_, err = svc.RefreshTokens(ctx, login.RefreshToken)
	require.NoError(t, err)

	_, err = svc.RefreshTokens(ctx, login.RefreshToken)
	require.Error(t, err)
	appErr, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "INVALID_TOKEN", appErr.Code)
}

func TestRefreshTokens_UnknownToken_ReturnsInvalidToken(t *testing.T) {
	svc := newTestService(t)
	_, err := svc.RefreshTokens(context.Background(), "not-a-real-token")
	require.Error(t, err)
	appErr, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "INVALID_TOKEN", appErr.Code)
}

func TestLogout_DeletesRefreshToken(t *testing.T) {
	svc := newTestService(t)
	registerAndVerify(t, svc, "logout-test@example.com", "SecureP@ss123", "LogoutTest")
	ctx := context.Background()

	login, err := svc.Login(ctx, auth.LoginInput{Email: "logout-test@example.com", Password: "SecureP@ss123"})
	require.NoError(t, err)

	require.NoError(t, svc.Logout(ctx, login.RefreshToken))

	_, err = svc.RefreshTokens(ctx, login.RefreshToken)
	require.Error(t, err, "a logged-out refresh token must no longer work")
}

func TestLogout_UnknownToken_DoesNotError(t *testing.T) {
	svc := newTestService(t)
	assert.NoError(t, svc.Logout(context.Background(), "never-existed"))
}

// TestLogin_EmailIsCaseInsensitive: registering with one casing and logging
// in with another must succeed — see TestRegister_EmailIsCaseInsensitive
// (Task 7) for why this matters.
func TestLogin_EmailIsCaseInsensitive(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()
	_, err := svc.Register(ctx, auth.RegisterInput{
		Email: "CaseTest@Example.com", Password: "SecureP@ss123", DisplayName: "CaseTest",
	})
	require.NoError(t, err)
	code, err := svc.PeekVerificationCodeForTest(ctx, "casetest@example.com")
	require.NoError(t, err)
	require.NoError(t, svc.VerifyEmail(ctx, "casetest@example.com", code))

	result, err := svc.Login(ctx, auth.LoginInput{Email: "CASETEST@EXAMPLE.COM", Password: "SecureP@ss123"})
	require.NoError(t, err)
	assert.Equal(t, "casetest@example.com", result.User.Email)
}

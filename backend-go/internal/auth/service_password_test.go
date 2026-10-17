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

func TestForgotPassword_ExistingEmail_StoresCodeAndReturnsNil(t *testing.T) {
	svc := newTestService(t)
	registerAndVerify(t, svc, "forgot-pw@example.com", "OldP@ssw0rd", "ForgotPw")

	err := svc.ForgotPassword(context.Background(), "forgot-pw@example.com")
	assert.NoError(t, err)
}

// TestForgotPassword_NonExistentEmail_StillReturnsNil pins Review Focus item
// 2: the response must not reveal whether the email exists.
func TestForgotPassword_NonExistentEmail_StillReturnsNil(t *testing.T) {
	svc := newTestService(t)
	err := svc.ForgotPassword(context.Background(), "ghost-forgot@example.com")
	assert.NoError(t, err)
}

func TestVerifyResetCode_CorrectCode_ReturnsResetToken(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()
	registerAndVerify(t, svc, "reset-code@example.com", "OldP@ssw0rd", "ResetCode")
	require.NoError(t, svc.ForgotPassword(ctx, "reset-code@example.com"))

	code, err := svc.PeekPasswordResetCodeForTest(ctx, "reset-code@example.com")
	require.NoError(t, err)

	token, err := svc.VerifyResetCode(ctx, "reset-code@example.com", code)
	require.NoError(t, err)
	assert.NotEmpty(t, token)
}

func TestVerifyResetCode_WrongCode_ReturnsInvalidToken(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()
	registerAndVerify(t, svc, "reset-wrong@example.com", "OldP@ssw0rd", "ResetWrong")
	require.NoError(t, svc.ForgotPassword(ctx, "reset-wrong@example.com"))

	_, err := svc.VerifyResetCode(ctx, "reset-wrong@example.com", "000000")
	require.Error(t, err)
	appErr, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "INVALID_TOKEN", appErr.Code)
}

func TestVerifyResetCode_NoCodeRequested_ReturnsTokenExpired(t *testing.T) {
	svc := newTestService(t)
	_, err := svc.VerifyResetCode(context.Background(), "never-requested@example.com", "123456")
	require.Error(t, err)
	appErr, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "TOKEN_EXPIRED", appErr.Code)
}

// TestVerifyResetCode_CodeIsSingleUse: like refresh tokens, a reset code
// must not be usable twice.
func TestVerifyResetCode_CodeIsSingleUse(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()
	registerAndVerify(t, svc, "reset-single-use@example.com", "OldP@ssw0rd", "SingleUseReset")
	require.NoError(t, svc.ForgotPassword(ctx, "reset-single-use@example.com"))
	code, err := svc.PeekPasswordResetCodeForTest(ctx, "reset-single-use@example.com")
	require.NoError(t, err)

	_, err = svc.VerifyResetCode(ctx, "reset-single-use@example.com", code)
	require.NoError(t, err)

	_, err = svc.VerifyResetCode(ctx, "reset-single-use@example.com", code)
	require.Error(t, err)
	appErr, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "TOKEN_EXPIRED", appErr.Code)
}

// TestUpdatePassword_CalledTwiceWithSameToken_SecondCallReturnsTokenExpired
// pins UpdatePassword's own single-use property: the verified-reset-token
// record is deleted on first use, so reusing the same token a second time
// must fail, mirroring TestVerifyResetCode_CodeIsSingleUse one step later in
// the flow.
func TestUpdatePassword_CalledTwiceWithSameToken_SecondCallReturnsTokenExpired(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()
	registerAndVerify(t, svc, "update-pw-twice@example.com", "OldP@ssw0rd", "UpdatePwTwice")
	require.NoError(t, svc.ForgotPassword(ctx, "update-pw-twice@example.com"))
	code, err := svc.PeekPasswordResetCodeForTest(ctx, "update-pw-twice@example.com")
	require.NoError(t, err)
	resetToken, err := svc.VerifyResetCode(ctx, "update-pw-twice@example.com", code)
	require.NoError(t, err)

	require.NoError(t, svc.UpdatePassword(ctx, "update-pw-twice@example.com", resetToken, "NewP@ssw0rd99"))

	err = svc.UpdatePassword(ctx, "update-pw-twice@example.com", resetToken, "AnotherP@ssw0rd99")
	require.Error(t, err)
	appErr, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "TOKEN_EXPIRED", appErr.Code)
}

// TestUpdatePassword_StaleResetTokenFromEarlierCycle_ReturnsInvalidToken:
// VerifyResetCode's verified-token record is keyed by email, so a second
// forgot/verify cycle overwrites the first cycle's record. A resetToken
// from the first (now-overwritten) cycle must be rejected as invalid, not
// silently accepted.
func TestUpdatePassword_StaleResetTokenFromEarlierCycle_ReturnsInvalidToken(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()
	registerAndVerify(t, svc, "update-pw-stale@example.com", "OldP@ssw0rd", "UpdatePwStale")

	require.NoError(t, svc.ForgotPassword(ctx, "update-pw-stale@example.com"))
	firstCode, err := svc.PeekPasswordResetCodeForTest(ctx, "update-pw-stale@example.com")
	require.NoError(t, err)
	staleResetToken, err := svc.VerifyResetCode(ctx, "update-pw-stale@example.com", firstCode)
	require.NoError(t, err)

	require.NoError(t, svc.ForgotPassword(ctx, "update-pw-stale@example.com"))
	secondCode, err := svc.PeekPasswordResetCodeForTest(ctx, "update-pw-stale@example.com")
	require.NoError(t, err)
	_, err = svc.VerifyResetCode(ctx, "update-pw-stale@example.com", secondCode)
	require.NoError(t, err)

	err = svc.UpdatePassword(ctx, "update-pw-stale@example.com", staleResetToken, "NewP@ssw0rd99")
	require.Error(t, err)
	appErr, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "INVALID_TOKEN", appErr.Code)
}

func TestUpdatePassword_ValidResetToken_ChangesPasswordAndAllowsLoginWithNewOne(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()
	registerAndVerify(t, svc, "update-pw@example.com", "OldP@ssw0rd", "UpdatePw")
	require.NoError(t, svc.ForgotPassword(ctx, "update-pw@example.com"))
	code, err := svc.PeekPasswordResetCodeForTest(ctx, "update-pw@example.com")
	require.NoError(t, err)
	resetToken, err := svc.VerifyResetCode(ctx, "update-pw@example.com", code)
	require.NoError(t, err)

	require.NoError(t, svc.UpdatePassword(ctx, "update-pw@example.com", resetToken, "NewP@ssw0rd99"))

	_, err = svc.Login(ctx, auth.LoginInput{Email: "update-pw@example.com", Password: "OldP@ssw0rd"})
	require.Error(t, err, "the old password must no longer work")

	result, err := svc.Login(ctx, auth.LoginInput{Email: "update-pw@example.com", Password: "NewP@ssw0rd99"})
	require.NoError(t, err, "the new password must work")
	assert.NotEmpty(t, result.AccessToken)
}

func TestUpdatePassword_WrongResetToken_ReturnsInvalidToken(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()
	registerAndVerify(t, svc, "update-pw-wrong@example.com", "OldP@ssw0rd", "UpdatePwWrong")
	require.NoError(t, svc.ForgotPassword(ctx, "update-pw-wrong@example.com"))
	code, err := svc.PeekPasswordResetCodeForTest(ctx, "update-pw-wrong@example.com")
	require.NoError(t, err)
	_, err = svc.VerifyResetCode(ctx, "update-pw-wrong@example.com", code)
	require.NoError(t, err)

	err = svc.UpdatePassword(ctx, "update-pw-wrong@example.com", "not-the-real-token", "NewP@ssw0rd99")
	require.Error(t, err)
	appErr, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "INVALID_TOKEN", appErr.Code)
}

func TestUpdatePassword_NoVerifiedTokenOnRecord_ReturnsTokenExpired(t *testing.T) {
	svc := newTestService(t)
	err := svc.UpdatePassword(context.Background(), "never-verified@example.com", "any-token", "NewP@ssw0rd99")
	require.Error(t, err)
	appErr, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "TOKEN_EXPIRED", appErr.Code)
}

// TestPasswordResetFlow_EmailIsCaseInsensitive: the whole three-step reset
// flow (forgot -> verify code -> update) must work when each step uses a
// different casing of the same address — see
// TestRegister_EmailIsCaseInsensitive (Task 7) for why.
func TestPasswordResetFlow_EmailIsCaseInsensitive(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()
	registerAndVerify(t, svc, "resetcase@example.com", "OldP@ssw0rd", "ResetCase")

	require.NoError(t, svc.ForgotPassword(ctx, "ResetCase@Example.com"))
	code, err := svc.PeekPasswordResetCodeForTest(ctx, "RESETCASE@EXAMPLE.COM")
	require.NoError(t, err)
	resetToken, err := svc.VerifyResetCode(ctx, "resetcase@EXAMPLE.com", code)
	require.NoError(t, err)
	require.NoError(t, svc.UpdatePassword(ctx, "ResetCase@example.COM", resetToken, "NewP@ssw0rd99"))

	_, err = svc.Login(ctx, auth.LoginInput{Email: "resetcase@example.com", Password: "NewP@ssw0rd99"})
	require.NoError(t, err)
}

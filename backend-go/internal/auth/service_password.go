package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"nexus-connect/backend-go/internal/platform/cache"
	apperrors "nexus-connect/backend-go/internal/platform/errors"

	platformauth "nexus-connect/backend-go/internal/platform/auth"
)

// passwordResetCodeTTL and passwordResetVerifiedTTL match
// config.tokenExpiry.passwordReset (1 hour) and the literal 600-second TTL
// auth.service.ts's verifyResetCode hardcodes for the post-verification
// token, respectively. See service_register.go's emailVerificationTTL note
// for why these are constants here rather than Config fields.
const (
	passwordResetCodeTTL     = time.Hour
	passwordResetVerifiedTTL = 10 * time.Minute
)

type passwordResetCodeRecord struct {
	UserID string `json:"userId"`
	Code   string `json:"code"`
}

type passwordResetVerifiedRecord struct {
	UserID     string `json:"userId"`
	ResetToken string `json:"resetToken"`
}

// ForgotPassword mirrors AuthService.forgotPassword, including its
// anti-enumeration contract (Review Focus item 2): always nil, whether the
// email exists or not.
func (s *Service) ForgotPassword(ctx context.Context, email string) error {
	email = strings.ToLower(email)

	userID, err := s.store.FindIDByEmail(ctx, email)
	if err != nil {
		return err
	}
	if userID == nil {
		return nil
	}

	code, err := randomSixDigitCode()
	if err != nil {
		return fmt.Errorf("auth: generating reset code: %w", err)
	}

	record, err := json.Marshal(passwordResetCodeRecord{UserID: *userID, Code: code})
	if err != nil {
		return fmt.Errorf("auth: encoding reset code record: %w", err)
	}
	if err := s.cache.Set(ctx, cache.PasswordResetKey(email), string(record), passwordResetCodeTTL); err != nil {
		return err
	}

	s.email.SendPasswordResetEmail(email, code)
	return nil
}

// VerifyResetCode mirrors AuthService.verifyResetCode: checks the 6-digit
// code, issues a single-use opaque reset token valid for 10 minutes, and
// deletes the code (it's now used).
func (s *Service) VerifyResetCode(ctx context.Context, email, code string) (string, error) {
	email = strings.ToLower(email)

	stored, err := s.cache.Get(ctx, cache.PasswordResetKey(email))
	if err != nil {
		if err == cache.ErrNotFound {
			return "", apperrors.TokenExpired()
		}
		return "", err
	}

	var record passwordResetCodeRecord
	if err := json.Unmarshal([]byte(stored), &record); err != nil {
		return "", fmt.Errorf("auth: decoding reset code record: %w", err)
	}

	if code != record.Code {
		return "", apperrors.InvalidToken()
	}

	resetToken, err := randomOpaqueToken()
	if err != nil {
		return "", fmt.Errorf("auth: generating reset token: %w", err)
	}

	verified, err := json.Marshal(passwordResetVerifiedRecord{UserID: record.UserID, ResetToken: resetToken})
	if err != nil {
		return "", fmt.Errorf("auth: encoding verified reset record: %w", err)
	}
	if err := s.cache.Set(ctx, cache.PasswordResetVerifiedKey(email), string(verified), passwordResetVerifiedTTL); err != nil {
		return "", err
	}

	if err := s.cache.Del(ctx, cache.PasswordResetKey(email)); err != nil {
		return "", err
	}

	return resetToken, nil
}

// UpdatePassword mirrors AuthService.updatePassword, including a gap the
// original documents and leaves unfixed with its own inline comment
// ("Invalidate all refresh tokens for this user... In production, you'd
// want to track all refresh tokens per user"): a password change here does
// not revoke any refresh token issued before it. Faithfully preserved, not
// a new regression — see Task 5's STARTTLS TODO(gap) for the project's
// established convention on gaps like this.
func (s *Service) UpdatePassword(ctx context.Context, email, resetToken, newPassword string) error {
	email = strings.ToLower(email)

	stored, err := s.cache.Get(ctx, cache.PasswordResetVerifiedKey(email))
	if err != nil {
		if err == cache.ErrNotFound {
			return apperrors.TokenExpired()
		}
		return err
	}

	var record passwordResetVerifiedRecord
	if err := json.Unmarshal([]byte(stored), &record); err != nil {
		return fmt.Errorf("auth: decoding verified reset record: %w", err)
	}

	if resetToken != record.ResetToken {
		return apperrors.InvalidToken()
	}

	passwordHash, err := platformauth.HashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("auth: hashing new password: %w", err)
	}

	found, err := s.store.UpdatePassword(ctx, record.UserID, passwordHash)
	if err != nil {
		return err
	}
	if !found {
		return apperrors.NotFound("User")
	}

	return s.cache.Del(ctx, cache.PasswordResetVerifiedKey(email))
}

// randomOpaqueToken mirrors
// `Math.random().toString(36).substring(2) + Date.now().toString(36)` in
// auth.service.ts: a short, URL-safe, unguessable single-use token. The
// original's construction isn't cryptographically strong (Math.random()
// isn't a CSPRNG) — this port deliberately uses a real CSPRNG
// (crypto/rand) instead, since nothing observable depends on the token's
// exact bytes or length, only that it is unguessable and matches on a
// later request. This is the same category of change as platform/auth's
// already-reviewed JWT-secret fail-closed behavior: an infra/security
// hardening substitution with no business-behavior impact, not a fidelity
// deviation.
func randomOpaqueToken() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// PeekPasswordResetCodeForTest mirrors PeekVerificationCodeForTest's reasoning.
func (s *Service) PeekPasswordResetCodeForTest(ctx context.Context, email string) (string, error) {
	email = strings.ToLower(email)
	stored, err := s.cache.Get(ctx, cache.PasswordResetKey(email))
	if err != nil {
		return "", err
	}
	var record passwordResetCodeRecord
	if err := json.Unmarshal([]byte(stored), &record); err != nil {
		return "", err
	}
	return record.Code, nil
}

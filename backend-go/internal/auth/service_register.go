package auth

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
	"time"

	"nexus-connect/backend-go/internal/platform/cache"
	"nexus-connect/backend-go/internal/platform/config"
	apperrors "nexus-connect/backend-go/internal/platform/errors"
	"nexus-connect/backend-go/internal/platform/events"
	"nexus-connect/backend-go/internal/platform/idgen"

	platformauth "nexus-connect/backend-go/internal/platform/auth"
)

// emailVerificationTTL matches config.tokenExpiry.emailVerification in
// backend/services/auth-service/src/config.ts (24 hours). This is hardcoded
// rather than threaded through platform/config because nothing in this
// codebase, today or in any planned future module, needs to override it
// independently of the business rule itself — if that changes, promoting it
// to a Config field is a one-line follow-up, not a redesign.
const emailVerificationTTL = 24 * time.Hour

type Service struct {
	store *Store
	cache *cache.Cache
	email *EmailSender
	bus   *events.Bus
	cfg   config.Config
}

func NewService(store *Store, c *cache.Cache, email *EmailSender, bus *events.Bus, cfg config.Config) *Service {
	return &Service{store: store, cache: c, email: email, bus: bus, cfg: cfg}
}

type RegisterInput struct {
	Email       string
	Password    string
	DisplayName string
}

type RegisterResult struct {
	UserID       string
	UniqueNumber string
}

type verificationCodeRecord struct {
	UserID string `json:"userId"`
	Code   string `json:"code"`
}

// Register mirrors AuthService.register in
// backend/services/auth-service/src/services/auth.service.ts.
//
// TODO(gap): concurrent duplicate registrations (same email, or colliding
// unique numbers) can both pass this existence check before either inserts
// — the DB UNIQUE constraint is the real backstop, but InsertUser's error
// isn't mapped back to DuplicateEmail, so the losing request surfaces as a
// generic 500 instead of a clean 409, see backend/services/auth-service/AGENTS.md.
func (s *Service) Register(ctx context.Context, input RegisterInput) (RegisterResult, error) {
	input.Email = strings.ToLower(input.Email)

	exists, err := s.store.ExistsByEmail(ctx, input.Email)
	if err != nil {
		return RegisterResult{}, err
	}
	if exists {
		return RegisterResult{}, apperrors.DuplicateEmail()
	}

	uniqueNumber, err := idgen.UniqueTenDigitNumber(ctx, s.store.ExistsByUniqueNumber, 10)
	if err != nil {
		return RegisterResult{}, fmt.Errorf("auth: generating unique number: %w", err)
	}

	passwordHash, err := platformauth.HashPassword(input.Password)
	if err != nil {
		return RegisterResult{}, fmt.Errorf("auth: hashing password: %w", err)
	}

	userID := idgen.TimeOrderedUUID()

	if err := s.store.InsertUser(ctx, userID, input.Email, passwordHash, uniqueNumber, input.DisplayName); err != nil {
		return RegisterResult{}, err
	}

	code, err := randomSixDigitCode()
	if err != nil {
		return RegisterResult{}, fmt.Errorf("auth: generating verification code: %w", err)
	}

	record, err := json.Marshal(verificationCodeRecord{UserID: userID, Code: code})
	if err != nil {
		return RegisterResult{}, fmt.Errorf("auth: encoding verification record: %w", err)
	}
	if err := s.cache.Set(ctx, cache.EmailVerificationKey(input.Email), string(record), emailVerificationTTL); err != nil {
		return RegisterResult{}, fmt.Errorf("auth: storing verification code: %w", err)
	}

	s.email.SendVerificationEmail(input.Email, code)

	s.bus.Publish(ctx, UserRegisteredEvent{
		UserID: userID, Email: input.Email, UniqueNumber: uniqueNumber, DisplayName: input.DisplayName,
	})

	return RegisterResult{UserID: userID, UniqueNumber: uniqueNumber}, nil
}

// VerifyEmail mirrors AuthService.verifyEmail.
func (s *Service) VerifyEmail(ctx context.Context, email, code string) error {
	email = strings.ToLower(email)

	stored, err := s.cache.Get(ctx, cache.EmailVerificationKey(email))
	if err != nil {
		if err == cache.ErrNotFound {
			return apperrors.TokenExpired()
		}
		return err
	}

	var record verificationCodeRecord
	if err := json.Unmarshal([]byte(stored), &record); err != nil {
		return fmt.Errorf("auth: decoding verification record: %w", err)
	}

	if code != record.Code {
		return apperrors.InvalidToken()
	}

	found, err := s.store.MarkEmailVerified(ctx, record.UserID)
	if err != nil {
		return err
	}
	if !found {
		return apperrors.NotFound("User")
	}

	if err := s.cache.Del(ctx, cache.EmailVerificationKey(email)); err != nil {
		return err
	}

	s.bus.Publish(ctx, UserEmailVerifiedEvent{UserID: record.UserID})
	return nil
}

// ResendVerificationEmail mirrors AuthService.resendVerificationEmail,
// including its anti-enumeration contract: it always returns nil, whether
// the email doesn't exist, is already verified, or genuinely got a new code.
func (s *Service) ResendVerificationEmail(ctx context.Context, email string) error {
	email = strings.ToLower(email)

	lookup, err := s.store.FindEmailVerified(ctx, email)
	if err != nil {
		return err
	}
	if lookup == nil || lookup.EmailVerified {
		return nil
	}

	code, err := randomSixDigitCode()
	if err != nil {
		return fmt.Errorf("auth: generating verification code: %w", err)
	}

	record, err := json.Marshal(verificationCodeRecord{UserID: lookup.ID, Code: code})
	if err != nil {
		return fmt.Errorf("auth: encoding verification record: %w", err)
	}
	if err := s.cache.Set(ctx, cache.EmailVerificationKey(email), string(record), emailVerificationTTL); err != nil {
		return err
	}

	s.email.SendVerificationEmail(email, code)
	return nil
}

// randomSixDigitCode mirrors Math.floor(100000 + Math.random() * 900000) in
// auth.service.ts: a uniformly random 6-digit string, "000000" never
// possible (the TS version's floor is 100000, not 0).
func randomSixDigitCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(900000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()+100000), nil
}

// PeekVerificationCodeForTest exposes the stored code so integration tests
// can complete the verify-email flow without needing to intercept the
// EmailSender's captured message body for this specific assertion. Exported
// (not a test-only build-tagged file) because this package's own tests are
// all in the external auth_test package, same convention as
// EmailSender.SetSendFuncForTest.
func (s *Service) PeekVerificationCodeForTest(ctx context.Context, email string) (string, error) {
	email = strings.ToLower(email)
	stored, err := s.cache.Get(ctx, cache.EmailVerificationKey(email))
	if err != nil {
		return "", err
	}
	var record verificationCodeRecord
	if err := json.Unmarshal([]byte(stored), &record); err != nil {
		return "", err
	}
	return record.Code, nil
}

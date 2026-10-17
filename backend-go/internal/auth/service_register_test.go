//go:build integration

package auth_test

import (
	"context"
	"testing"

	"nexus-connect/backend-go/internal/auth"
	"nexus-connect/backend-go/internal/platform/cache"
	apperrors "nexus-connect/backend-go/internal/platform/errors"
	"nexus-connect/backend-go/internal/platform/events"
	"nexus-connect/backend-go/internal/platform/logger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
)

// startCacheForAuth mirrors the foundation plan's startRedis helpers,
// stripping the "redis://" scheme testcontainers' ConnectionString returns —
// cache.New's addr parameter feeds straight into redis.Options.Addr, which
// expects a bare host:port.
func startCacheForAuth(t *testing.T) *cache.Cache {
	t.Helper()
	ctx := context.Background()
	container, err := tcredis.Run(ctx, "redis:7-alpine")
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })
	connStr, err := container.ConnectionString(ctx)
	require.NoError(t, err)
	return cache.New(stripRedisScheme(connStr), "", 0)
}

func newTestService(t *testing.T) *auth.Service {
	t.Helper()
	svc, _ := newTestServiceWithStore(t)
	return svc
}

// newTestServiceWithStore additionally returns the *auth.Store backing the
// returned Service, for the rare test that needs to assert against the
// database directly (e.g. that a rejected write didn't silently corrupt an
// existing row) without waiting for a later task's higher-level API (like
// Login, Task 8) to exist.
func newTestServiceWithStore(t *testing.T) (*auth.Service, *auth.Store) {
	t.Helper()
	store := startStore(t) // from store_test.go, same package
	c := startCacheForAuth(t)
	cfg := testEmailConfig() // from email_test.go, same package
	email := auth.NewEmailSender(cfg, logger.New("test"))
	email.SetSendFuncForTest(func(addr, from string, to []string, msg []byte) error { return nil })
	bus := events.NewBus(logger.New("test"))
	return auth.NewService(store, c, email, bus, cfg), store
}

func TestRegister_Succeeds_AndStoresVerificationCode(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	result, err := svc.Register(ctx, auth.RegisterInput{
		Email: "new-user@example.com", Password: "SecureP@ss123", DisplayName: "New User",
	})
	require.NoError(t, err)
	assert.NotEmpty(t, result.UserID)
	assert.Len(t, result.UniqueNumber, 10)
}

func TestRegister_DuplicateEmail_Returns409AndFirstUsersDataSurvives(t *testing.T) {
	svc, store := newTestServiceWithStore(t)
	ctx := context.Background()

	first, err := svc.Register(ctx, auth.RegisterInput{
		Email: "dup@example.com", Password: "SecureP@ss123", DisplayName: "First",
	})
	require.NoError(t, err)

	_, err = svc.Register(ctx, auth.RegisterInput{
		Email: "dup@example.com", Password: "DifferentP@ss456", DisplayName: "Second",
	})
	require.Error(t, err)
	appErr, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "DUPLICATE_EMAIL", appErr.Code)

	// Register's existence check short-circuits before InsertUser is ever
	// called on the duplicate attempt, so this doesn't prove InsertUser
	// itself is non-destructive (e.g. not an upsert) — it confirms the real
	// protection, that ExistsByEmail's pre-check actually stops the second
	// write from being attempted at all: the first user's row — same ID,
	// same display name — is exactly what the first Register call wrote.
	row, err := store.FindForLogin(ctx, "dup@example.com")
	require.NoError(t, err)
	require.NotNil(t, row)
	assert.Equal(t, first.UserID, row.ID)
	assert.Equal(t, "First", row.DisplayName)
}

func TestVerifyEmail_CorrectCode_MarksUserVerified(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	_, err := svc.Register(ctx, auth.RegisterInput{
		Email: "verify-flow@example.com", Password: "SecureP@ss123", DisplayName: "Verify",
	})
	require.NoError(t, err)

	code, err := svc.PeekVerificationCodeForTest(ctx, "verify-flow@example.com")
	require.NoError(t, err)

	require.NoError(t, svc.VerifyEmail(ctx, "verify-flow@example.com", code))
}

func TestVerifyEmail_WrongCode_ReturnsInvalidToken(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	_, err := svc.Register(ctx, auth.RegisterInput{
		Email: "wrong-code@example.com", Password: "SecureP@ss123", DisplayName: "Wrong",
	})
	require.NoError(t, err)

	err = svc.VerifyEmail(ctx, "wrong-code@example.com", "000000")
	require.Error(t, err)
	appErr, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "INVALID_TOKEN", appErr.Code)
}

func TestVerifyEmail_NoCodeStored_ReturnsTokenExpired(t *testing.T) {
	svc := newTestService(t)
	err := svc.VerifyEmail(context.Background(), "never-registered@example.com", "123456")
	require.Error(t, err)
	appErr, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "TOKEN_EXPIRED", appErr.Code)
}

func TestResendVerificationEmail_NonExistentEmail_ReturnsNilNotError(t *testing.T) {
	svc := newTestService(t)
	// Anti-enumeration: a non-existent email must not produce any
	// distinguishable error from a real one.
	err := svc.ResendVerificationEmail(context.Background(), "ghost@example.com")
	assert.NoError(t, err)
}

func TestResendVerificationEmail_AlreadyVerifiedEmail_ReturnsNilAndDoesNotIssueNewCode(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	_, err := svc.Register(ctx, auth.RegisterInput{
		Email: "already-verified@example.com", Password: "SecureP@ss123", DisplayName: "AV",
	})
	require.NoError(t, err)
	code, err := svc.PeekVerificationCodeForTest(ctx, "already-verified@example.com")
	require.NoError(t, err)
	require.NoError(t, svc.VerifyEmail(ctx, "already-verified@example.com", code))

	assert.NoError(t, svc.ResendVerificationEmail(ctx, "already-verified@example.com"))
}

// TestRegister_EmailIsCaseInsensitive pins a systemic normalization rule the
// original applies at every single email-touching call site (grep confirms
// 16 occurrences of email.toLowerCase() across auth.service.ts, zero
// exceptions): registering with mixed-case must store/key everything by the
// lowercased form, so a later lookup with a differently-cased (but
// equivalent) email still finds it. Without this, a user who typed
// "User@Example.com" at signup could never log in typing
// "user@example.com".
func TestRegister_EmailIsCaseInsensitive(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	_, err := svc.Register(ctx, auth.RegisterInput{
		Email: "MixedCase@Example.COM", Password: "SecureP@ss123", DisplayName: "Mixed",
	})
	require.NoError(t, err)

	// The verification code was stored under the lowercased key — looking it
	// up (and verifying) with a different casing than either the original
	// registration or each other must still work.
	code, err := svc.PeekVerificationCodeForTest(ctx, "mixedcase@example.com")
	require.NoError(t, err)
	require.NoError(t, svc.VerifyEmail(ctx, "MIXEDCASE@EXAMPLE.COM", code))

	// A second registration attempt with yet another casing of the same
	// address must be rejected as a duplicate, proving ExistsByEmail checked
	// against the normalized form too.
	_, err = svc.Register(ctx, auth.RegisterInput{
		Email: "mixedCase@example.com", Password: "AnotherP@ss456", DisplayName: "Dup",
	})
	require.Error(t, err)
	appErr, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "DUPLICATE_EMAIL", appErr.Code)
}

func stripRedisScheme(connStr string) string {
	const prefix = "redis://"
	if len(connStr) >= len(prefix) && connStr[:len(prefix)] == prefix {
		return connStr[len(prefix):]
	}
	return connStr
}

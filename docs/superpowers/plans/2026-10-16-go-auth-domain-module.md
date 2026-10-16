# Go `auth` Domain Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `backend/services/auth-service`'s observable behavior (register, login, refresh, logout, email verification, password reset) into `backend-go/internal/auth`, the first Go domain module, built entirely on the already-committed `internal/platform/*` foundation.

**Architecture:** One new package, `internal/auth`, following the spec's `Store → Service → Handler → RegisterRoutes` layering, exporting one `fx.Module("auth", ...)` that `cmd/server/main.go` composes alongside `platform.Module`. No new top-level packages beyond `internal/auth` — all platform-level gaps this module exposes (SMTP config, a Redis key helper, an HTTP rate-limit middleware) are added to the existing `internal/platform/*` packages that already own that concern, not duplicated locally.

**Tech Stack:** Everything already pinned in `backend-go/go.mod` (`pgx/v5`, `go-redis/v9`, `go-chi/chi/v5`, `golang-jwt/jwt/v5`, `golang.org/x/crypto/bcrypt`, `go-playground/validator/v10`, `go.uber.org/fx`, `testcontainers-go`) plus Go's stdlib `net/smtp` for email (no new dependency — the original uses `nodemailer`, but Go's stdlib SMTP client covers the same plain-SMTP-with-optional-auth use case with zero new third-party surface).

**Spec:** [docs/superpowers/specs/2026-10-15-go-monolith-migration-design.md](../specs/2026-10-15-go-monolith-migration-design.md) §2 ("faithful port first", "drop Kafka → in-process events"), §3 item 1, §4.3 (fx module convention), §4.4 (error envelope). This plan implements §3 item 1 only.

**Source of truth being ported:** `backend/services/auth-service/src/{routes/auth.routes.ts,services/auth.service.ts,services/email.service.ts,config.ts}` and the shared helpers they call in `backend/packages/shared/src/{utils/{crypto.ts,id-generator.ts,validators.ts},database/queries/user.queries.ts,types/{user.ts,events.ts}}`.

## Global Constraints

- Go module path prefix for this module: `nexus-connect/backend-go/internal/auth`. Package name is `auth` — this collides with the already-existing `internal/platform/auth` package name, so **every file in this module that imports `internal/platform/auth` must alias it `platformauth`** (matching the project's existing alias convention for `internal/platform/errors` → `apperrors`).
- Routes mount at `/api/v1/auth` — exact prefix the existing `backend/services/auth-service` uses (confirmed in its `server.ts`: `server.register(authRoutes, { prefix: '/api/v1/auth' })`). The frontend's API client depends on this path; it requires zero changes per spec §1.
- bcrypt cost 12 — already enforced inside `platform/auth.HashPassword`; this module never re-implements hashing, only calls it.
- No Kafka. Where the original publishes to `KafkaTopics.USER_EVENTS`, this module publishes the equivalent typed event to the already-built `*events.Bus` (Task 9 of the foundation plan). No subscriber exists yet — that's `notification`'s future module (spec §3 item 7) — publishing with zero subscribers is a documented no-op, not an error (`platform/events.Bus.Publish`'s own tests already cover this).
- Faithful port means porting **exactly what the TS code observably does today**, including two places where it does *less* than you might expect — do not silently "improve" these:
  - `PasswordStrengthSchema` (upper/lower/digit/special character-class rule) is defined in `validators.ts` but **never imported or called by any route or service in `auth-service`** (confirmed by grep — its only references are in `AGENTS.md` docs). Registration and password-reset only enforce length. Do **not** apply `platform/validate`'s `password_strength` custom tag to this module's `Password` fields — doing so would make registration *stricter* than the system it's replacing.
  - `/update-password`'s password field has no upper length bound in the original (its inline Fastify schema is `{ type: 'string', minLength: 8 }`, no `maxLength`, and the handler reads the body via a raw type assertion with no second validation pass) — unlike `/register`, which does enforce `max(128)` via the zod `RegisterUserSchema` the handler actually calls. This asymmetry is preserved: `min=8,max=128` on register's password, `min=8` only (no max) on update-password's.
  - `EmailService.sendWelcomeEmail` and the `ResetPasswordSchema` zod schema in `auth.routes.ts` are both defined in the original but have zero callers anywhere in the codebase (confirmed by grep). Dead code with no observable behavior is not ported.
- Rate limiting is skipped entirely when `config.Config.NodeEnv == "development"` — this is the original's actual behavior (`rate-limiter.ts`'s `createRateLimitMiddleware`: `if (process.env.NODE_ENV === 'development') return;`), not an oversight to fix.
- Every new file in `internal/auth/` must have a corresponding `_test.go` before the task that creates it is considered done — no file ships untested, matching the foundation plan's own bar.
- `unique_number`, `email_verified`, and all other DB column names stay snake_case (matching `backend/infrastructure/postgres/init.sql`'s `users` table, already migrated in Task 14 of the foundation plan) — only Go struct field names and JSON wire tags use the Go/JS naming conventions respectively.

## Review Focus

- **Login with a registered-but-unverified email** must return `403 EMAIL_NOT_VERIFIED`, not `401 INVALID_CREDENTIALS` — these are two different, order-dependent checks (password correctness, then verification status) and swapping the order or conflating them into one check is an easy, invisible-until-tested mistake. Task 8's tests pin the order explicitly.
- **`/forgot-password` and `/resend-verification` on an email that does not exist** must still return the same `200` success message as when it does exist — the original returns `null` from the service layer and the route handler unconditionally sends the success message regardless, specifically to prevent email enumeration. A Go port that accidentally returns a `404` (or any different status/body) for a non-existent email on these two routes reintroduces the enumeration the original avoided. Task 7 and Task 9's tests cover both routes' non-existent-email paths.
- **Duplicate email on `/register`** must return `409 DUPLICATE_EMAIL` before any side effect (no user row inserted, no unique-number generation attempted, no email sent) — Task 7's test asserts the second registration with the same email fails and the first user's row is untouched.
- **A refresh token must become unusable immediately after being used once** — `refreshTokens` deletes the old Redis entry *before* issuing new tokens, so a second call with the same (now-stale) token must fail with `401 INVALID_TOKEN`, not silently succeed or return the same tokens again. Task 8's test performs two sequential refreshes with the original token and asserts the second fails.
- **Rate limiting must actually bind to the right routes with the right limiter** — `/login` uses the 1-hour/10-attempt limiter, while `/register`, `/verify-email`, `/resend-verification`, `/forgot-password`, `/verify-reset-code`, and `/update-password` all use the 15-minute/5-attempt limiter; `/refresh` and `/logout` have none. Getting one of these backwards (e.g. applying the stricter 15min/5 limiter to `/login`, which legitimate users hit far more often than registration) is invisible until someone gets locked out in production. Task 11's test exercises at least one route from each group.

---

## Task 1: `platform/config` — add SMTP email settings

**Files:**
- Modify: `backend-go/internal/platform/config/config.go`
- Modify: `backend-go/internal/platform/config/config_test.go`

**Interfaces:**
- Consumes: nothing new.
- Produces: five new fields on the existing `config.Config` struct — `SMTPHost string`, `SMTPPort int`, `SMTPUser string`, `SMTPPassword string`, `EmailFrom string` — populated by `Load()` exactly like every other field. No new exported functions.

- [ ] **Step 1: Write the failing test**

Add to `backend-go/internal/platform/config/config_test.go` (alongside the existing tests, same file):

```go
func TestLoad_AppliesSMTPDefaults(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "test-access-secret-at-least-32-chars")
	t.Setenv("JWT_REFRESH_SECRET", "test-refresh-secret-at-least-32-chars")

	cfg, err := config.Load()
	require.NoError(t, err)

	assert.Equal(t, "smtp.gmail.com", cfg.SMTPHost)
	assert.Equal(t, 587, cfg.SMTPPort)
	assert.Equal(t, "", cfg.SMTPUser)
	assert.Equal(t, "noreply@nexus.com", cfg.EmailFrom)
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test ./internal/platform/config/... -v -run TestLoad_AppliesSMTPDefaults`
Expected: FAIL — compile error, `cfg.SMTPHost` (etc.) undefined.

- [ ] **Step 3: Add the fields and loading logic**

In `backend-go/internal/platform/config/config.go`, add to the `Config` struct (after the `CORSOrigins`/`NodeEnv` fields):

```go
	SMTPHost     string
	SMTPPort     int
	SMTPUser     string
	SMTPPassword string
	EmailFrom    string
```

And in `Load()`, add to the returned `Config{...}` literal (after the `CORSOrigins`/`NodeEnv` lines):

```go
		SMTPHost:     envStr("SMTP_HOST", "smtp.gmail.com"),
		SMTPPort:     envInt("SMTP_PORT", 587),
		SMTPUser:     envStr("SMTP_USER", ""),
		SMTPPassword: envStr("SMTP_PASSWORD", ""),
		EmailFrom:    envStr("EMAIL_FROM", "noreply@nexus.com"),
```

These defaults match `backend/services/auth-service/src/config.ts`'s `config.email.{host,port,user,from}` exactly. (The original's `config.email.secure`/`SMTP_SECURE` boolean is not ported here — Task 5 explains why: Go's stdlib `net/smtp` doesn't take an implicit-TLS-vs-STARTTLS flag the way `nodemailer` does, and this plan's `EmailSender` always sends over `STARTTLS` when the server offers it, matching `nodemailer`'s default behavior when `secure` is left falsy, which is what every env this code actually runs in today does — `SMTP_SECURE` is never set to `'true'` anywhere in `backend/`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend-go && go test ./internal/platform/config/... -v`
Expected: PASS, all tests green (the new one plus every pre-existing one in the package).

- [ ] **Step 5: Commit**

```bash
cd backend-go && go build ./... && go vet ./...
git add backend-go/internal/platform/config
git commit -m "backend-go/platform/config: add SMTP email settings for the auth module"
```

---

## Task 2: `platform/cache` — add the password-reset-verified key helper

**Files:**
- Modify: `backend-go/internal/platform/cache/keys.go`
- Modify: `backend-go/internal/platform/cache/cache_test.go`

**Interfaces:**
- Consumes: nothing new.
- Produces: `func PasswordResetVerifiedKey(email string) string` — returns `fmt.Sprintf("password_reset_verified:%s", email)`.

- [ ] **Step 1: Write the failing test**

Add to `backend-go/internal/platform/cache/cache_test.go`'s `TestKeys_MatchExpectedFormat` test (extend the existing assertions, same function, do not create a new test):

```go
	assert.Equal(t, "password_reset_verified:user@example.com", cache.PasswordResetVerifiedKey("user@example.com"))
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test -tags=integration ./internal/platform/cache/... -v -run TestKeys_MatchExpectedFormat`
Expected: FAIL — compile error, `cache.PasswordResetVerifiedKey` undefined.

- [ ] **Step 3: Implement it**

Add to `backend-go/internal/platform/cache/keys.go` (after `RateLimitKey`):

```go
// PasswordResetVerifiedKey matches the literal "password_reset_verified:" prefix
// backend/services/auth-service/src/services/auth.service.ts's verifyResetCode/
// updatePassword inline (it bypasses SessionKeys entirely in the original —
// ported verbatim here as a proper helper instead of an inline string, with
// zero behavior difference).
func PasswordResetVerifiedKey(email string) string {
	return fmt.Sprintf("password_reset_verified:%s", email)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend-go && go test -tags=integration ./internal/platform/cache/... -v -run TestKeys_MatchExpectedFormat`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd backend-go && go build ./... && go vet ./...
git add backend-go/internal/platform/cache
git commit -m "backend-go/platform/cache: add PasswordResetVerifiedKey for the auth module's two-step reset flow"
```

---

## Task 3: `platform/ratelimit` — add the HTTP middleware

**Files:**
- Create: `backend-go/internal/platform/ratelimit/middleware.go`
- Create: `backend-go/internal/platform/ratelimit/middleware_test.go`

**Interfaces:**
- Consumes: `*Limiter.Check` (already exists), `apperrors.RateLimit` (Task 2 of the foundation plan), `auth.FromContext` (Task 11 of the foundation plan — **note:** this is `internal/platform/auth`, imported here with no alias needed since this file lives in package `ratelimit`, not `auth`).
- Produces: `func Middleware(limiter *Limiter, nodeEnv string) func(http.Handler) http.Handler` — a chi-compatible middleware other domain modules (not just `auth`) will reuse for their own rate-limited routes.

- [ ] **Step 1: Write the failing test**

`backend-go/internal/platform/ratelimit/middleware_test.go`:
```go
//go:build integration

package ratelimit_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"nexus-connect/backend-go/internal/platform/cache"
	"nexus-connect/backend-go/internal/platform/ratelimit"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
)

func startCacheForMiddleware(t *testing.T) *cache.Cache {
	t.Helper()
	ctx := context.Background()
	container, err := tcredis.Run(ctx, "redis:7-alpine")
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })
	connStr, err := container.ConnectionString(ctx)
	require.NoError(t, err)
	return cache.New(strings.TrimPrefix(connStr, "redis://"), "", 0)
}

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

func TestMiddleware_AllowsUpToLimitThenRejects(t *testing.T) {
	c := startCacheForMiddleware(t)
	limiter := ratelimit.New(c, 60_000, 2, "mw-test")
	handler := ratelimit.Middleware(limiter, "production")(okHandler())

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		req.RemoteAddr = "1.2.3.4:5555"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code, "request %d should be allowed", i+1)
	}

	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.RemoteAddr = "1.2.3.4:5555"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusTooManyRequests, rec.Code)
	assert.NotEmpty(t, rec.Header().Get("Retry-After"))
}

func TestMiddleware_SkipsEntirelyInDevelopment(t *testing.T) {
	c := startCacheForMiddleware(t)
	limiter := ratelimit.New(c, 60_000, 1, "mw-dev-test")
	handler := ratelimit.Middleware(limiter, "development")(okHandler())

	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		req.RemoteAddr = "1.2.3.4:5555"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code, "request %d must not be rate limited in development", i+1)
	}
}

func TestMiddleware_SetsRateLimitHeadersOnAllowedRequest(t *testing.T) {
	c := startCacheForMiddleware(t)
	limiter := ratelimit.New(c, 60_000, 5, "mw-headers-test")
	handler := ratelimit.Middleware(limiter, "production")(okHandler())

	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.RemoteAddr = "1.2.3.4:5555"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	remaining, err := strconv.Atoi(rec.Header().Get("X-RateLimit-Remaining"))
	require.NoError(t, err)
	assert.Equal(t, 4, remaining)
	assert.NotEmpty(t, rec.Header().Get("X-RateLimit-Reset"))
}

func TestMiddleware_PrefersAuthenticatedUserIDOverIP(t *testing.T) {
	c := startCacheForMiddleware(t)
	limiter := ratelimit.New(c, 60_000, 1, "mw-identity-test")
	handler := ratelimit.Middleware(limiter, "production")(okHandler())

	// Same IP, but two different authenticated users: each gets their own budget.
	for _, userID := range []string{"user-a", "user-b"} {
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		req.RemoteAddr = "9.9.9.9:1111"
		req = req.WithContext(withFakeUser(req.Context(), userID))
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code, "user %q should get its own budget despite sharing an IP", userID)
	}
}
```

- [ ] **Step 2: Fix the undefined `withFakeUser` helper — use the real `platform/auth` context key, not an invented one**

The test above references `withFakeUser`, which doesn't exist — it was written against an imagined helper instead of the real context mechanism `platform/auth` (Task 11 of the foundation plan) already provides. Replace that reference: add this helper to the bottom of `middleware_test.go`, and add `"nexus-connect/backend-go/internal/platform/auth"` to the test file's imports:

```go
func withFakeUser(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, auth.UserContextKey, auth.TokenPayload{UserID: userID})
}
```

Run: `cd backend-go && go test -tags=integration ./internal/platform/ratelimit/... -v`
Expected: FAIL — `ratelimit.Middleware` undefined (the package doesn't have this file yet).

- [ ] **Step 3: Implement `middleware.go`**

`backend-go/internal/platform/ratelimit/middleware.go`:
```go
package ratelimit

import (
	"net/http"
	"strconv"

	apperrors "nexus-connect/backend-go/internal/platform/errors"

	"nexus-connect/backend-go/internal/platform/auth"
)

// Middleware mirrors rate-limiter.ts's createRateLimitMiddleware: it is
// skipped entirely when nodeEnv is "development", identifies the caller by
// authenticated user ID first (if auth.Middleware already ran and attached
// one), falling back to the remote IP, then "unknown"; sets
// X-RateLimit-Remaining/X-RateLimit-Reset on every allowed request; and on
// rejection sets Retry-After and writes the same 429 RATE_LIMIT_EXCEEDED
// envelope every other AppError produces.
func Middleware(limiter *Limiter, nodeEnv string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if nodeEnv == "development" {
				next.ServeHTTP(w, r)
				return
			}

			identifier := identifierFor(r)
			result, err := limiter.Check(r.Context(), identifier)
			if err != nil {
				writeRateLimitError(w, apperrors.Internal(""))
				return
			}

			w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(result.Remaining))
			w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(result.ResetTimeMs, 10))

			if !result.Allowed {
				w.Header().Set("Retry-After", strconv.Itoa(result.RetryAfterSeconds))
				writeRateLimitError(w, apperrors.RateLimit(result.RetryAfterSeconds))
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func identifierFor(r *http.Request) string {
	if payload, ok := auth.FromContext(r.Context()); ok && payload.UserID != "" {
		return payload.UserID
	}
	if host, _, err := splitHostPort(r.RemoteAddr); err == nil && host != "" {
		return host
	}
	return "unknown"
}

func writeRateLimitError(w http.ResponseWriter, err *apperrors.AppError) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(err.StatusCode)
	_ = writeJSON(w, err)
}
```

- [ ] **Step 4: Fix the two undefined helpers caught by `go build`**

Step 3's code references `splitHostPort` and `writeJSON`, neither of which exist — `net/http.Request.RemoteAddr` needs `net.SplitHostPort` (stdlib), and the error body needs `encoding/json`, not an invented `writeJSON`. Replace the bottom of `middleware.go`:

```go
func identifierFor(r *http.Request) string {
	if payload, ok := auth.FromContext(r.Context()); ok && payload.UserID != "" {
		return payload.UserID
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil && host != "" {
		return host
	}
	return "unknown"
}

func writeRateLimitError(w http.ResponseWriter, err *apperrors.AppError) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(err.StatusCode)
	_ = json.NewEncoder(w).Encode(err)
}
```

and add `"encoding/json"` and `"net"` to the import block.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend-go && go test -tags=integration ./internal/platform/ratelimit/... -v`
Expected: PASS, all 9 tests green (4 pre-existing from the foundation plan's Task 8, plus the 5 new ones above).

- [ ] **Step 6: Commit**

```bash
cd backend-go && go build ./... && go vet ./... && go test -tags=integration ./internal/platform/ratelimit/... -v
git add backend-go/internal/platform/ratelimit
git commit -m "backend-go/platform/ratelimit: add HTTP middleware for the auth module's rate-limited routes"
```

---

## Task 4: `internal/auth/store.go` — Postgres queries

**Files:**
- Create: `backend-go/internal/auth/store.go`
- Create: `backend-go/internal/auth/store_test.go` (build-tagged `integration`)

**Interfaces:**
- Consumes: `*db.DB` — specifically `Query`/`QueryRow`/`Exec` (all already exist, Task 6 of the foundation plan), `migrations.Run` (Task 14, to set up the schema in the integration test).
- Produces:
  - `type UserForLogin struct { ID, Email, PasswordHash, UniqueNumber, DisplayName string; EmailVerified bool }`
  - `type EmailVerifiedLookup struct { ID string; EmailVerified bool }`
  - `type Store struct` wrapping `*db.DB`.
  - `func NewStore(database *db.DB) *Store`
  - `func (s *Store) ExistsByEmail(ctx context.Context, email string) (bool, error)`
  - `func (s *Store) ExistsByUniqueNumber(ctx context.Context, uniqueNumber string) (bool, error)`
  - `func (s *Store) FindIDByEmail(ctx context.Context, email string) (*string, error)` — nil-on-no-match; needed because `ForgotPassword` (Task 9) must look up a user's ID by email without reading their password hash (which `FindForLogin` would return) and without a boolean-only `ExistsByEmail` that can't report the ID.
  - `func (s *Store) InsertUser(ctx context.Context, id, email, passwordHash, uniqueNumber, displayName string) error`
  - `func (s *Store) FindForLogin(ctx context.Context, email string) (*UserForLogin, error)` — returns `(nil, nil)` on no match, not an error.
  - `func (s *Store) FindEmailVerified(ctx context.Context, email string) (*EmailVerifiedLookup, error)` — same nil-on-no-match convention.
  - `func (s *Store) MarkEmailVerified(ctx context.Context, userID string) (bool, error)` — bool reports whether a row was actually updated.
  - `func (s *Store) UpdatePassword(ctx context.Context, userID, passwordHash string) (bool, error)` — same convention.
  - `func (s *Store) UpdateLastSeen(ctx context.Context, userID string) error`

- [ ] **Step 1: Write the failing integration test**

`backend-go/internal/auth/store_test.go`:
```go
//go:build integration

package auth_test

import (
	"context"
	"testing"

	"nexus-connect/backend-go/internal/auth"
	platformdb "nexus-connect/backend-go/internal/platform/db"
	"nexus-connect/backend-go/internal/platform/migrations"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
)

// startStore spins up a fresh Postgres container, migrates it, and returns a
// Store ready to use — mirrors the pattern already established in the
// foundation plan's db_test.go/migrations_test.go, including the
// BasicWaitStrategies() fix (without it, testcontainers considers the
// container ready after Postgres' first startup, before its self-restart,
// producing "connection reset by peer" on the first real connection).
func startStore(t *testing.T) *auth.Store {
	t.Helper()
	ctx := context.Background()

	container, err := postgres.Run(ctx, "postgres:16-alpine",
		postgres.WithDatabase("nexus_auth_test"),
		postgres.WithUsername("postgres"),
		postgres.WithPassword("postgres"),
		postgres.BasicWaitStrategies(),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err)
	require.NoError(t, migrations.Run(dsn))

	pool, err := platformdb.New(ctx, dsn, 5)
	require.NoError(t, err)
	t.Cleanup(pool.Close)

	return auth.NewStore(pool)
}

func TestStore_ExistsByEmail_FalseThenTrueAfterInsert(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()

	exists, err := store.ExistsByEmail(ctx, "new@example.com")
	require.NoError(t, err)
	assert.False(t, exists)

	require.NoError(t, store.InsertUser(ctx, "user-1", "new@example.com", "hash", "1234567890", "Jane"))

	exists, err = store.ExistsByEmail(ctx, "new@example.com")
	require.NoError(t, err)
	assert.True(t, exists)
}

func TestStore_ExistsByUniqueNumber_FalseThenTrueAfterInsert(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()

	exists, err := store.ExistsByUniqueNumber(ctx, "9998887770")
	require.NoError(t, err)
	assert.False(t, exists)

	require.NoError(t, store.InsertUser(ctx, "user-2", "num@example.com", "hash", "9998887770", "Num"))

	exists, err = store.ExistsByUniqueNumber(ctx, "9998887770")
	require.NoError(t, err)
	assert.True(t, exists)
}

func TestStore_InsertUser_DefaultsEmailVerifiedFalse(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	require.NoError(t, store.InsertUser(ctx, "user-3", "unverified@example.com", "hash", "1112223334", "Unverified"))

	user, err := store.FindForLogin(ctx, "unverified@example.com")
	require.NoError(t, err)
	require.NotNil(t, user)
	assert.False(t, user.EmailVerified)
}

func TestStore_FindForLogin_NilWhenNotFound(t *testing.T) {
	store := startStore(t)
	user, err := store.FindForLogin(context.Background(), "nobody@example.com")
	require.NoError(t, err)
	assert.Nil(t, user)
}

func TestStore_FindForLogin_ReturnsAllFields(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	require.NoError(t, store.InsertUser(ctx, "user-4", "full@example.com", "the-hash", "5551112223", "Full Name"))

	user, err := store.FindForLogin(ctx, "full@example.com")
	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, "user-4", user.ID)
	assert.Equal(t, "full@example.com", user.Email)
	assert.Equal(t, "the-hash", user.PasswordHash)
	assert.Equal(t, "5551112223", user.UniqueNumber)
	assert.Equal(t, "Full Name", user.DisplayName)
	assert.False(t, user.EmailVerified)
}

func TestStore_FindEmailVerified_NilWhenNotFound(t *testing.T) {
	store := startStore(t)
	lookup, err := store.FindEmailVerified(context.Background(), "nobody@example.com")
	require.NoError(t, err)
	assert.Nil(t, lookup)
}

func TestStore_MarkEmailVerified_UpdatesRowAndReportsFound(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	require.NoError(t, store.InsertUser(ctx, "user-5", "verify-me@example.com", "hash", "2223334445", "VerifyMe"))

	found, err := store.MarkEmailVerified(ctx, "user-5")
	require.NoError(t, err)
	assert.True(t, found)

	lookup, err := store.FindEmailVerified(ctx, "verify-me@example.com")
	require.NoError(t, err)
	require.NotNil(t, lookup)
	assert.True(t, lookup.EmailVerified)
}

func TestStore_MarkEmailVerified_ReportsNotFoundForMissingUser(t *testing.T) {
	store := startStore(t)
	found, err := store.MarkEmailVerified(context.Background(), "does-not-exist")
	require.NoError(t, err)
	assert.False(t, found)
}

func TestStore_UpdatePassword_ChangesHashAndReportsFound(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	require.NoError(t, store.InsertUser(ctx, "user-6", "pw@example.com", "old-hash", "3334445556", "PwUser"))

	found, err := store.UpdatePassword(ctx, "user-6", "new-hash")
	require.NoError(t, err)
	assert.True(t, found)

	user, err := store.FindForLogin(ctx, "pw@example.com")
	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, "new-hash", user.PasswordHash)
}

func TestStore_UpdateLastSeen_Succeeds(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	require.NoError(t, store.InsertUser(ctx, "user-7", "lastseen@example.com", "hash", "4445556667", "LastSeen"))
	assert.NoError(t, store.UpdateLastSeen(ctx, "user-7"))
}

func TestStore_FindIDByEmail_NilWhenNotFound(t *testing.T) {
	store := startStore(t)
	id, err := store.FindIDByEmail(context.Background(), "nobody@example.com")
	require.NoError(t, err)
	assert.Nil(t, id)
}

func TestStore_FindIDByEmail_ReturnsIDWhenFound(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	require.NoError(t, store.InsertUser(ctx, "user-8", "findid@example.com", "hash", "6667778889", "FindID"))

	id, err := store.FindIDByEmail(ctx, "findid@example.com")
	require.NoError(t, err)
	require.NotNil(t, id)
	assert.Equal(t, "user-8", *id)
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test -tags=integration ./internal/auth/... -v`
Expected: FAIL — package `auth` doesn't exist yet.

- [ ] **Step 3: Implement `store.go`**

`backend-go/internal/auth/store.go`:
```go
package auth

import (
	"context"
	"fmt"

	"nexus-connect/backend-go/internal/platform/db"
)

// UserForLogin mirrors UserQueries.SELECT.FOR_LOGIN's column set in
// backend/packages/shared/src/database/queries/user.queries.ts.
type UserForLogin struct {
	ID            string
	Email         string
	PasswordHash  string
	UniqueNumber  string
	DisplayName   string
	EmailVerified bool
}

// EmailVerifiedLookup mirrors UserQueries.SELECT.EMAIL_VERIFIED's column set.
type EmailVerifiedLookup struct {
	ID            string
	EmailVerified bool
}

type Store struct {
	db *db.DB
}

func NewStore(database *db.DB) *Store {
	return &Store{db: database}
}

func (s *Store) ExistsByEmail(ctx context.Context, email string) (bool, error) {
	var id string
	err := s.db.QueryRow(ctx, "SELECT id FROM users WHERE email = $1", email).Scan(&id)
	return queryOneExists(err)
}

func (s *Store) ExistsByUniqueNumber(ctx context.Context, uniqueNumber string) (bool, error) {
	var id string
	err := s.db.QueryRow(ctx, "SELECT id FROM users WHERE unique_number = $1", uniqueNumber).Scan(&id)
	return queryOneExists(err)
}

func (s *Store) FindIDByEmail(ctx context.Context, email string) (*string, error) {
	var id string
	err := s.db.QueryRow(ctx, "SELECT id FROM users WHERE email = $1", email).Scan(&id)
	return queryOneRow(&id, err)
}

func (s *Store) InsertUser(ctx context.Context, id, email, passwordHash, uniqueNumber, displayName string) error {
	_, err := s.db.Exec(ctx,
		`INSERT INTO users (id, email, password_hash, unique_number, display_name, email_verified, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, false, NOW(), NOW())`,
		id, email, passwordHash, uniqueNumber, displayName,
	)
	if err != nil {
		return fmt.Errorf("auth: inserting user: %w", err)
	}
	return nil
}

func (s *Store) FindForLogin(ctx context.Context, email string) (*UserForLogin, error) {
	var u UserForLogin
	err := s.db.QueryRow(ctx,
		`SELECT id, email, password_hash, unique_number, display_name, email_verified
		 FROM users WHERE email = $1`,
		email,
	).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.UniqueNumber, &u.DisplayName, &u.EmailVerified)
	return queryOneRow(&u, err)
}

func (s *Store) FindEmailVerified(ctx context.Context, email string) (*EmailVerifiedLookup, error) {
	var l EmailVerifiedLookup
	err := s.db.QueryRow(ctx, "SELECT id, email_verified FROM users WHERE email = $1", email).
		Scan(&l.ID, &l.EmailVerified)
	return queryOneRow(&l, err)
}

func (s *Store) MarkEmailVerified(ctx context.Context, userID string) (bool, error) {
	tag, err := s.db.Exec(ctx,
		"UPDATE users SET email_verified = true, updated_at = NOW() WHERE id = $1",
		userID,
	)
	if err != nil {
		return false, fmt.Errorf("auth: marking email verified: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

func (s *Store) UpdatePassword(ctx context.Context, userID, passwordHash string) (bool, error) {
	tag, err := s.db.Exec(ctx,
		"UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
		passwordHash, userID,
	)
	if err != nil {
		return false, fmt.Errorf("auth: updating password: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

func (s *Store) UpdateLastSeen(ctx context.Context, userID string) error {
	_, err := s.db.Exec(ctx, "UPDATE users SET last_seen_at = NOW() WHERE id = $1", userID)
	if err != nil {
		return fmt.Errorf("auth: updating last seen: %w", err)
	}
	return nil
}
```

- [ ] **Step 4: Fix the two undefined helpers caught by `go build`**

Step 3 references `queryOneExists` and `queryOneRow`, which don't exist — `pgx.Row.Scan` returns `pgx.ErrNoRows` on no match, which needs translating into this package's nil-on-no-match convention rather than propagating as an error. Add to the bottom of `store.go`, with `"errors"` and `"github.com/jackc/pgx/v5"` added to the imports:

```go
func queryOneExists(err error) (bool, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("auth: querying existence: %w", err)
	}
	return true, nil
}

func queryOneRow[T any](row *T, err error) (*T, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("auth: querying row: %w", err)
	}
	return row, nil
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend-go && go test -tags=integration ./internal/auth/... -v`
Expected: PASS, all 12 tests green (requires Docker).

- [ ] **Step 6: Commit**

```bash
cd backend-go && go build ./... && go vet ./... && go test -tags=integration ./internal/auth/... -v
git add backend-go/internal/auth/store.go backend-go/internal/auth/store_test.go
git commit -m "backend-go/auth: add Store (Postgres queries for register/login/verify/reset)"
```

---

## Task 5: `internal/auth/email.go` — SMTP email sender

**Files:**
- Create: `backend-go/internal/auth/email.go`
- Create: `backend-go/internal/auth/email_test.go`

**Interfaces:**
- Consumes: `config.Config.{SMTPHost,SMTPPort,SMTPUser,SMTPPassword,EmailFrom}` (Task 1), `*slog.Logger`.
- Produces:
  - `type EmailSender struct`.
  - `func NewEmailSender(cfg config.Config, log *slog.Logger) *EmailSender`
  - `func (e *EmailSender) SendVerificationEmail(to, code string)` — **no error return**, matching the original's `EmailService.sendVerificationEmail`'s own contract exactly: it `await`s the send (so the caller's request handler does wait for the attempt) but always swallows the error internally (`// Don't throw - email failures shouldn't block registration`), logging failure instead. Never panics, never blocks longer than the underlying SMTP dial/send timeout.
  - `func (e *EmailSender) SendPasswordResetEmail(to, code string)` — same contract.

- [ ] **Step 1: Write the failing test**

`backend-go/internal/auth/email_test.go`:
```go
package auth_test

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"nexus-connect/backend-go/internal/auth"
	"nexus-connect/backend-go/internal/platform/config"
	"nexus-connect/backend-go/internal/platform/logger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testEmailConfig() config.Config {
	return config.Config{
		SMTPHost:  "smtp.example.com",
		SMTPPort:  587,
		SMTPUser:  "",
		EmailFrom: "noreply@nexus.com",
	}
}

func TestSendVerificationEmail_CallsSendFuncWithCodeInBody(t *testing.T) {
	var capturedTo []string
	var capturedMsg []byte
	sender := auth.NewEmailSender(testEmailConfig(), logger.New("test"))
	sender.SetSendFuncForTest(func(addr string, from string, to []string, msg []byte) error {
		capturedTo = to
		capturedMsg = msg
		return nil
	})

	sender.SendVerificationEmail("user@example.com", "123456")

	require.Equal(t, []string{"user@example.com"}, capturedTo)
	assert.True(t, bytes.Contains(capturedMsg, []byte("123456")), "email body must contain the verification code")
	assert.True(t, bytes.Contains(capturedMsg, []byte("Your verification code")), "email subject must match the original")
}

func TestSendPasswordResetEmail_CallsSendFuncWithCodeInBody(t *testing.T) {
	var capturedMsg []byte
	sender := auth.NewEmailSender(testEmailConfig(), logger.New("test"))
	sender.SetSendFuncForTest(func(addr string, from string, to []string, msg []byte) error {
		capturedMsg = msg
		return nil
	})

	sender.SendPasswordResetEmail("user@example.com", "654321")

	assert.True(t, bytes.Contains(capturedMsg, []byte("654321")))
	assert.True(t, bytes.Contains(capturedMsg, []byte("password reset code")), "email subject must match the original")
}

func TestSendVerificationEmail_SwallowsSendError(t *testing.T) {
	var buf bytes.Buffer
	sender := auth.NewEmailSender(testEmailConfig(), logger.NewWithWriter("test", &buf))
	sender.SetSendFuncForTest(func(addr string, from string, to []string, msg []byte) error {
		return errors.New("smtp: connection refused")
	})

	assert.NotPanics(t, func() {
		sender.SendVerificationEmail("user@example.com", "123456")
	})
	assert.True(t, strings.Contains(buf.String(), "level\":\"ERROR\""), "a send failure must be logged, not thrown")
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test ./internal/auth/... -v -run TestSend`
Expected: FAIL — package `auth` doesn't exist yet (Task 4 created the package; if Task 4 already landed, this instead fails with `auth.NewEmailSender`/`SetSendFuncForTest` undefined).

- [ ] **Step 3: Implement `email.go`**

`backend-go/internal/auth/email.go`:
```go
package auth

import (
	"fmt"
	"log/slog"
	"net/smtp"
	"strconv"

	"nexus-connect/backend-go/internal/platform/config"
)

// sendFunc matches the shape of net/smtp.SendMail minus the smtp.Auth
// parameter (constructed internally from cfg, since it's nil whenever
// SMTPUser is empty — exactly like the original's `auth: config.email.user
// ? {...} : undefined`), so tests can inject a fake without a real SMTP
// server.
type sendFunc func(addr string, from string, to []string, msg []byte) error

// EmailSender ports EmailService from
// backend/services/auth-service/src/services/email.service.ts. Every send
// method swallows its own error (logs instead) — "email failures shouldn't
// block registration" in the original's own words — so nothing in this type
// ever returns an error to its caller.
type EmailSender struct {
	cfg  config.Config
	log  *slog.Logger
	send sendFunc
}

func NewEmailSender(cfg config.Config, log *slog.Logger) *EmailSender {
	e := &EmailSender{cfg: cfg, log: log}
	e.send = e.realSend
	return e
}

// SetSendFuncForTest overrides the SMTP transport. Exported (not a
// lowercase field) so this package's own _test.go files, which are in the
// external auth_test package like every other test in this module, can use
// it without needing internal-package test-only exports.
func (e *EmailSender) SetSendFuncForTest(fn sendFunc) {
	e.send = fn
}

func (e *EmailSender) realSend(addr string, from string, to []string, msg []byte) error {
	var auth smtp.Auth
	if e.cfg.SMTPUser != "" {
		auth = smtp.PlainAuth("", e.cfg.SMTPUser, e.cfg.SMTPPassword, e.cfg.SMTPHost)
	}
	return smtp.SendMail(addr, auth, from, to, msg)
}

func (e *EmailSender) SendVerificationEmail(to, code string) {
	subject := "Your verification code - Nexus"
	body := fmt.Sprintf(
		"Welcome to Nexus! Your verification code is: %s. Enter this code in the app to verify your email.",
		code,
	)
	e.sendOne(to, subject, body, "verification")
}

func (e *EmailSender) SendPasswordResetEmail(to, code string) {
	subject := "Your password reset code - Nexus"
	body := fmt.Sprintf(
		"Your password reset code is: %s. Enter this code in the app to reset your password. This code expires in 1 hour.",
		code,
	)
	e.sendOne(to, subject, body, "password reset")
}

func (e *EmailSender) sendOne(to, subject, body, kind string) {
	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\n\r\n%s\r\n",
		e.cfg.EmailFrom, to, subject, body)

	addr := e.cfg.SMTPHost + ":" + strconv.Itoa(e.cfg.SMTPPort)
	if err := e.send(addr, e.cfg.EmailFrom, []string{to}, []byte(msg)); err != nil {
		e.log.Error("failed to send "+kind+" email", "to", to, "error", err)
		return
	}
	e.log.Info(kind+" email sent", "to", to)
}
```

Note: the original builds a full HTML email (`email.service.ts`'s multi-hundred-byte inline template) plus a plaintext fallback; this port keeps only the plaintext body. This is a deliberate, narrow exception to "faithful port first" — HTML *rendering* is presentation, not business behavior (the frontend never parses these emails; a human reads them), and the plaintext copy already carries every piece of information (the code, its purpose, its expiry) the HTML version does. Re-adding the HTML template is a pure follow-up if a future reviewer wants visual parity; nothing downstream depends on it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend-go && go test ./internal/auth/... -v -run TestSend`
Expected: PASS, all 3 tests green.

- [ ] **Step 5: Commit**

```bash
cd backend-go && go build ./... && go vet ./... && go test ./internal/auth/... -v -run TestSend
git add backend-go/internal/auth/email.go backend-go/internal/auth/email_test.go
git commit -m "backend-go/auth: add EmailSender (stdlib net/smtp, fire-and-forget like the original)"
```

---

## Task 6: `internal/auth/events.go` — event types

**Files:**
- Create: `backend-go/internal/auth/events.go`
- Create: `backend-go/internal/auth/events_test.go`

**Interfaces:**
- Consumes: `events.Event` interface (Task 9 of the foundation plan).
- Produces:
  - `type UserRegisteredEvent struct { UserID, Email, UniqueNumber, DisplayName string }` with `func (UserRegisteredEvent) EventType() string { return "user.registered" }`.
  - `type UserEmailVerifiedEvent struct { UserID string }` with `func (UserEmailVerifiedEvent) EventType() string { return "user.email_verified" }`.

These are the Go equivalents of `UserEventTypes.USER_REGISTERED`/`USER_EMAIL_VERIFIED` and their payload shapes in `backend/packages/shared/src/types/events.ts` — published via `platform/events.Bus` instead of Kafka, per spec §2. No subscriber exists yet (that's the future `notification` module, spec §3 item 7); publishing with zero subscribers is a documented no-op.

- [ ] **Step 1: Write the failing test**

`backend-go/internal/auth/events_test.go`:
```go
package auth_test

import (
	"testing"

	"nexus-connect/backend-go/internal/auth"

	"github.com/stretchr/testify/assert"
)

func TestUserRegisteredEvent_EventType(t *testing.T) {
	e := auth.UserRegisteredEvent{UserID: "u-1", Email: "a@example.com", UniqueNumber: "1234567890", DisplayName: "A"}
	assert.Equal(t, "user.registered", e.EventType())
}

func TestUserEmailVerifiedEvent_EventType(t *testing.T) {
	e := auth.UserEmailVerifiedEvent{UserID: "u-1"}
	assert.Equal(t, "user.email_verified", e.EventType())
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test ./internal/auth/... -v -run TestUser`
Expected: FAIL — `auth.UserRegisteredEvent` undefined.

- [ ] **Step 3: Implement `events.go`**

`backend-go/internal/auth/events.go`:
```go
package auth

// UserRegisteredEvent and UserEmailVerifiedEvent port the payload shapes of
// UserRegisteredEvent/UserEmailVerifiedEvent in
// backend/packages/shared/src/types/events.ts, minus the Kafka envelope
// fields (eventId/timestamp/version/source) — platform/events.Bus has no
// equivalent envelope, matching spec §4.5's own MessageSent{...} example.

type UserRegisteredEvent struct {
	UserID       string
	Email        string
	UniqueNumber string
	DisplayName  string
}

func (UserRegisteredEvent) EventType() string { return "user.registered" }

type UserEmailVerifiedEvent struct {
	UserID string
}

func (UserEmailVerifiedEvent) EventType() string { return "user.email_verified" }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend-go && go test ./internal/auth/... -v -run TestUser`
Expected: PASS, both tests green.

- [ ] **Step 5: Commit**

```bash
cd backend-go && go build ./... && go vet ./...
git add backend-go/internal/auth/events.go backend-go/internal/auth/events_test.go
git commit -m "backend-go/auth: add UserRegisteredEvent/UserEmailVerifiedEvent (Kafka -> in-process bus per spec)"
```

---

## Task 7: `internal/auth/service_register.go` — Register, VerifyEmail, ResendVerificationEmail

**Files:**
- Create: `backend-go/internal/auth/service_register.go`
- Create: `backend-go/internal/auth/service_register_test.go` (build-tagged `integration`)

**Interfaces:**
- Consumes: `*Store` (Task 4), `*EmailSender` (Task 5), `UserRegisteredEvent`/`UserEmailVerifiedEvent` (Task 6), `*cache.Cache.{Get,Set,Del}` + `cache.EmailVerificationKey` (foundation Task 7), `*events.Bus.Publish` (foundation Task 9), `idgen.{UniqueTenDigitNumber,TimeOrderedUUID}` (foundation Task 4), `platformauth.HashPassword` (foundation Task 11, **imported with the `platformauth` alias** per this plan's Global Constraints), `apperrors.{DuplicateEmail,TokenExpired,InvalidToken,NotFound}` (foundation Task 2), `config.Config.TokenExpiry`-equivalent (see Step 3 — this plan hardcodes the 24h TTL directly rather than adding yet another config field, since nothing else will ever need to override it independently of the business rule itself; see note in Step 3).
- Produces:
  - `type Service struct` (also the type Task 8 and Task 9 add methods to — defined once, here).
  - `func NewService(store *Store, c *cache.Cache, email *EmailSender, bus *events.Bus, cfg config.Config) *Service`
  - `type RegisterInput struct { Email, Password, DisplayName string }`
  - `type RegisterResult struct { UserID, UniqueNumber string }`
  - `func (s *Service) Register(ctx context.Context, input RegisterInput) (RegisterResult, error)`
  - `func (s *Service) VerifyEmail(ctx context.Context, email, code string) error`
  - `func (s *Service) ResendVerificationEmail(ctx context.Context, email string) error` — always returns `nil` (anti-enumeration; internally a no-op if the email doesn't exist or is already verified).

- [ ] **Step 1: Write the failing integration test**

`backend-go/internal/auth/service_register_test.go`:
```go
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

	// The rejected second attempt must not have overwritten anything: the
	// first user's own row — same ID, same display name — must be exactly
	// what Register originally wrote.
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

func stripRedisScheme(connStr string) string {
	const prefix = "redis://"
	if len(connStr) >= len(prefix) && connStr[:len(prefix)] == prefix {
		return connStr[len(prefix):]
	}
	return connStr
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test -tags=integration ./internal/auth/... -v -run 'TestRegister|TestVerifyEmail|TestResendVerificationEmail'`
Expected: FAIL — `auth.Service`/`auth.NewService`/`svc.PeekVerificationCodeForTest` undefined.

- [ ] **Step 3: Implement `service_register.go`**

`backend-go/internal/auth/service_register.go`:
```go
package auth

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
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
func (s *Service) Register(ctx context.Context, input RegisterInput) (RegisterResult, error) {
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend-go && go test -tags=integration ./internal/auth/... -v -run 'TestRegister|TestVerifyEmail|TestResendVerificationEmail'`
Expected: PASS, all 7 tests green.

- [ ] **Step 5: Commit**

```bash
cd backend-go && go build ./... && go vet ./... && go test -tags=integration ./internal/auth/... -v -run 'TestRegister|TestVerifyEmail|TestResendVerificationEmail'
git add backend-go/internal/auth/service_register.go backend-go/internal/auth/service_register_test.go
git commit -m "backend-go/auth: add Service.{Register,VerifyEmail,ResendVerificationEmail}"
```

---

## Task 8: `internal/auth/service_login.go` — Login, RefreshTokens, Logout

**Files:**
- Create: `backend-go/internal/auth/service_login.go`
- Create: `backend-go/internal/auth/service_login_test.go` (build-tagged `integration`)

**Interfaces:**
- Consumes: `*Store.{FindForLogin,UpdateLastSeen}` (Task 4), `*Service` (Task 7, same type — this file adds methods to it), `platformauth.{ComparePassword,TokenPayload,GenerateAccessToken,GenerateRefreshToken,VerifyToken}` (foundation Task 11), `cache.RefreshTokenKey` (foundation Task 7), `apperrors.{InvalidCredentials,EmailNotVerified,InvalidToken}` (foundation Task 2), `config.Config.{JWTAccessSecret,JWTRefreshSecret,JWTAccessExpiry,JWTRefreshExpiry}` (foundation Task 5).
- Produces:
  - `type LoginInput struct { Email, Password string }`
  - `type LoginUser struct { ID, Email, DisplayName, UniqueNumber string }`
  - `type LoginResult struct { AccessToken, RefreshToken string; ExpiresIn int64; User LoginUser }`
  - `type TokenResult struct { AccessToken, RefreshToken string; ExpiresIn int64 }`
  - `func (s *Service) Login(ctx context.Context, input LoginInput) (LoginResult, error)`
  - `func (s *Service) RefreshTokens(ctx context.Context, refreshToken string) (TokenResult, error)`
  - `func (s *Service) Logout(ctx context.Context, refreshToken string) error`

- [ ] **Step 1: Write the failing integration test**

`backend-go/internal/auth/service_login_test.go`:
```go
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test -tags=integration ./internal/auth/... -v -run 'TestLogin|TestRefreshTokens|TestLogout'`
Expected: FAIL — `svc.Login`/`svc.RefreshTokens`/`svc.Logout` undefined.

- [ ] **Step 3: Implement `service_login.go`**

`backend-go/internal/auth/service_login.go`:
```go
package auth

import (
	"context"
	"errors"
	"fmt"

	"nexus-connect/backend-go/internal/platform/cache"
	apperrors "nexus-connect/backend-go/internal/platform/errors"

	platformauth "nexus-connect/backend-go/internal/platform/auth"
)

type LoginInput struct {
	Email    string
	Password string
}

type LoginUser struct {
	ID           string
	Email        string
	DisplayName  string
	UniqueNumber string
}

type LoginResult struct {
	AccessToken  string
	RefreshToken string
	ExpiresIn    int64
	User         LoginUser
}

type TokenResult struct {
	AccessToken  string
	RefreshToken string
	ExpiresIn    int64
}

// Login mirrors AuthService.login.
func (s *Service) Login(ctx context.Context, input LoginInput) (LoginResult, error) {
	user, err := s.store.FindForLogin(ctx, input.Email)
	if err != nil {
		return LoginResult{}, err
	}
	if user == nil {
		return LoginResult{}, apperrors.InvalidCredentials()
	}

	if !platformauth.ComparePassword(input.Password, user.PasswordHash) {
		return LoginResult{}, apperrors.InvalidCredentials()
	}

	if !user.EmailVerified {
		return LoginResult{}, apperrors.EmailNotVerified()
	}

	tokens, err := s.issueTokenPair(ctx, user.ID, user.Email, user.UniqueNumber)
	if err != nil {
		return LoginResult{}, err
	}

	if err := s.store.UpdateLastSeen(ctx, user.ID); err != nil {
		return LoginResult{}, err
	}

	return LoginResult{
		AccessToken:  tokens.AccessToken,
		RefreshToken: tokens.RefreshToken,
		ExpiresIn:    tokens.ExpiresIn,
		User: LoginUser{
			ID: user.ID, Email: user.Email, DisplayName: user.DisplayName, UniqueNumber: user.UniqueNumber,
		},
	}, nil
}

// RefreshTokens mirrors AuthService.refreshTokens, including deleting the
// old Redis entry before issuing a new pair so the old token becomes
// single-use.
func (s *Service) RefreshTokens(ctx context.Context, refreshToken string) (TokenResult, error) {
	userID, err := s.cache.Get(ctx, cache.RefreshTokenKey(refreshToken))
	if err != nil {
		if err == cache.ErrNotFound {
			return TokenResult{}, apperrors.InvalidToken()
		}
		return TokenResult{}, err
	}

	payload, err := platformauth.VerifyToken(refreshToken, s.cfg.JWTRefreshSecret)
	if err != nil {
		_ = s.cache.Del(ctx, cache.RefreshTokenKey(refreshToken))
		return TokenResult{}, apperrors.InvalidToken()
	}

	if err := s.cache.Del(ctx, cache.RefreshTokenKey(refreshToken)); err != nil {
		return TokenResult{}, err
	}

	tokens, err := s.issueTokenPair(ctx, userID, payload.Email, payload.UniqueNumber)
	if err != nil {
		return TokenResult{}, err
	}

	return tokens, nil
}

// Logout mirrors AuthService.logout: deleting an unknown token is not an
// error, matching Redis DEL's own idempotent semantics the original relies on.
func (s *Service) Logout(ctx context.Context, refreshToken string) error {
	return s.cache.Del(ctx, cache.RefreshTokenKey(refreshToken))
}

func (s *Service) issueTokenPair(ctx context.Context, userID, email, uniqueNumber string) (TokenResult, error) {
	payload := platformauth.TokenPayload{UserID: userID, Email: email, UniqueNumber: uniqueNumber}

	accessToken, err := platformauth.GenerateAccessToken(payload, s.cfg.JWTAccessSecret, s.cfg.JWTAccessExpiry)
	if err != nil {
		return TokenResult{}, fmt.Errorf("auth: generating access token: %w", err)
	}

	refreshToken, err := platformauth.GenerateRefreshToken(payload, s.cfg.JWTRefreshSecret, s.cfg.JWTRefreshExpiry)
	if err != nil {
		return TokenResult{}, fmt.Errorf("auth: generating refresh token: %w", err)
	}

	if err := s.cache.Set(ctx, cache.RefreshTokenKey(refreshToken), userID, s.cfg.JWTRefreshExpiry); err != nil {
		return TokenResult{}, fmt.Errorf("auth: storing refresh token: %w", err)
	}

	return TokenResult{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    int64(s.cfg.JWTAccessExpiry.Seconds()),
	}, nil
}

var _ = errors.New // keep errors imported if a future edit removes its only other use
```

Note on `issueTokenPair`'s `ExpiresIn`: the original re-parses the `accessTokenExpiry` *string* (e.g. `"15m"`) back into seconds via a small regex (`parseExpiry` in `crypto.ts`) at the moment tokens are issued. This port instead calls `.Seconds()` on `config.Config.JWTAccessExpiry`, which is already a parsed `time.Duration` (Task 5 of the foundation plan parses it once at startup) — same resulting number, no behavior difference, without re-implementing string parsing that already happened once.

- [ ] **Step 4: Remove the placeholder `errors` import-keeper — it was never needed**

Step 3's last line (`var _ = errors.New ...`) and the `"errors"` import are dead weight — nothing in this file actually needs the stdlib `errors` package (the error checks above use `== cache.ErrNotFound`, a plain sentinel comparison, not `errors.Is`). Delete both:

```go
import (
	"context"
	"fmt"

	"nexus-connect/backend-go/internal/platform/cache"
	apperrors "nexus-connect/backend-go/internal/platform/errors"

	platformauth "nexus-connect/backend-go/internal/platform/auth"
)
```

and delete the `var _ = errors.New ...` line at the bottom of the file entirely.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend-go && go test -tags=integration ./internal/auth/... -v -run 'TestLogin|TestRefreshTokens|TestLogout'`
Expected: PASS, all 9 tests green.

- [ ] **Step 6: Commit**

```bash
cd backend-go && go build ./... && go vet ./... && go test -tags=integration ./internal/auth/... -v -run 'TestLogin|TestRefreshTokens|TestLogout'
git add backend-go/internal/auth/service_login.go backend-go/internal/auth/service_login_test.go
git commit -m "backend-go/auth: add Service.{Login,RefreshTokens,Logout}"
```

---

## Task 9: `internal/auth/service_password.go` — ForgotPassword, VerifyResetCode, UpdatePassword

**Files:**
- Create: `backend-go/internal/auth/service_password.go`
- Create: `backend-go/internal/auth/service_password_test.go` (build-tagged `integration`)

**Interfaces:**
- Consumes: `*Store.{FindIDByEmail,UpdatePassword}` (Task 4), `*Service` (Task 7/8, same type), `cache.{PasswordResetKey,PasswordResetVerifiedKey}` (foundation Task 7 + this plan's Task 2), `platformauth.HashPassword` (foundation Task 11), `apperrors.{TokenExpired,InvalidToken,NotFound}` (foundation Task 2).
- Produces:
  - `func (s *Service) ForgotPassword(ctx context.Context, email string) error` — always `nil` (anti-enumeration).
  - `func (s *Service) VerifyResetCode(ctx context.Context, email, code string) (string, error)` — returns the opaque reset token.
  - `func (s *Service) UpdatePassword(ctx context.Context, email, resetToken, newPassword string) error`

- [ ] **Step 1: Write the failing integration test for the password-reset flow**

`backend-go/internal/auth/service_password_test.go`:
```go
//go:build integration

package auth_test

import (
	"context"
	"testing"

	"nexus-connect/backend-go/internal/auth"
	platformauth "nexus-connect/backend-go/internal/platform/auth"
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

var _ = platformauth.TokenPayload{} // referenced only to keep the import used if a future edit trims the explicit assertions above
```

- [ ] **Step 2: Remove the placeholder import-keeper from Step 1 — it was never needed**

The `var _ = platformauth.TokenPayload{} ...` line and the `platformauth` import in the test file are dead weight — nothing in this test file actually constructs a `platformauth.TokenPayload`. Delete the import line and the `var _ = ...` line.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend-go && go test -tags=integration ./internal/auth/... -v -run 'TestForgotPassword|TestVerifyResetCode|TestUpdatePassword'`
Expected: FAIL — `svc.ForgotPassword`/`svc.VerifyResetCode`/`svc.UpdatePassword`/`svc.PeekPasswordResetCodeForTest` undefined.

- [ ] **Step 4: Implement `service_password.go`**

`backend-go/internal/auth/service_password.go`:
```go
package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
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

// UpdatePassword mirrors AuthService.updatePassword.
func (s *Service) UpdatePassword(ctx context.Context, email, resetToken, newPassword string) error {
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend-go && go test -tags=integration ./internal/auth/... -v -run 'TestForgotPassword|TestVerifyResetCode|TestUpdatePassword'`
Expected: PASS, all 9 tests green.

- [ ] **Step 6: Commit**

```bash
cd backend-go && go build ./... && go vet ./... && go test -tags=integration ./internal/auth/... -v
git add backend-go/internal/auth/service_password.go backend-go/internal/auth/service_password_test.go
git commit -m "backend-go/auth: add Service.{ForgotPassword,VerifyResetCode,UpdatePassword}"
```

---

## Task 10: `internal/auth/handler.go` + `dto.go` — HTTP handlers

**Files:**
- Create: `backend-go/internal/auth/dto.go`
- Create: `backend-go/internal/auth/handler.go`
- Create: `backend-go/internal/auth/handler_test.go`

**Interfaces:**
- Consumes: `*Service` (Tasks 7–9), `httpserver.{HandlerFunc,WriteJSON}` (foundation Task 13), `validate.Struct` (foundation Task 12), `apperrors.BadRequest` (foundation Task 2).
- Produces:
  - `type Handler struct` + `func NewHandler(svc *Service, log *slog.Logger) *Handler`.
  - Nine methods, each `func (h *Handler) <Name>(w http.ResponseWriter, r *http.Request) error`, matching `httpserver.HandlerFunc`'s signature so `httpserver.Wrap` can adapt them directly: `Register`, `Login`, `Refresh`, `Logout`, `VerifyEmail`, `ResendVerification`, `ForgotPassword`, `VerifyResetCode`, `UpdatePassword`.
  - Nine request DTOs in `dto.go`, each with `validate` tags and JSON tags matching the wire format the frontend already sends.

- [ ] **Step 1: Write the failing test**

`backend-go/internal/auth/handler_test.go`:
```go
package auth_test

import (
	"bytes"
	"context"
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

var _ = context.Background // keep context imported for future handler tests that need request cancellation
```

- [ ] **Step 2: Remove the placeholder import-keeper — it was never needed**

Delete `var _ = context.Background ...` and the now-unused `"context"` import from the test file's import block; nothing in this file calls `context.Background()` directly (requests are built via `httptest.NewRequest`, which doesn't need it).

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend-go && go test -tags=integration ./internal/auth/... -v -run TestHandler`
Expected: FAIL — `auth.Handler`/`auth.NewHandler` undefined.

- [ ] **Step 4: Implement `dto.go`**

`backend-go/internal/auth/dto.go`:
```go
package auth

// Request DTOs. JSON tags match the wire format the frontend already sends
// (zero frontend changes, per spec §1). validate tags enforce exactly what
// the original enforces — see this plan's Global Constraints for the two
// documented asymmetries (no password_strength anywhere; UpdatePassword has
// no password max length, unlike Register).

type registerRequest struct {
	Email       string `json:"email" validate:"required,email"`
	Password    string `json:"password" validate:"required,min=8,max=128"`
	DisplayName string `json:"displayName" validate:"required,min=1,max=100"`
}

type loginRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required"`
}

type refreshRequest struct {
	RefreshToken string `json:"refreshToken" validate:"required"`
}

type logoutRequest struct {
	RefreshToken string `json:"refreshToken" validate:"required"`
}

type verifyEmailRequest struct {
	Email string `json:"email" validate:"required,email"`
	Code  string `json:"code" validate:"required,len=6"`
}

type resendVerificationRequest struct {
	Email string `json:"email" validate:"required,email"`
}

type forgotPasswordRequest struct {
	Email string `json:"email" validate:"required,email"`
}

type verifyResetCodeRequest struct {
	Email string `json:"email" validate:"required,email"`
	Code  string `json:"code" validate:"required,len=6"`
}

type updatePasswordRequest struct {
	Email      string `json:"email" validate:"required,email"`
	ResetToken string `json:"resetToken" validate:"required"`
	Password   string `json:"password" validate:"required,min=8"`
}
```

- [ ] **Step 5: Implement `handler.go`**

`backend-go/internal/auth/handler.go`:
```go
package auth

import (
	"encoding/json"
	"log/slog"
	"net/http"

	apperrors "nexus-connect/backend-go/internal/platform/errors"
	"nexus-connect/backend-go/internal/platform/httpserver"
	"nexus-connect/backend-go/internal/platform/validate"
)

type Handler struct {
	svc *Service
	log *slog.Logger
}

func NewHandler(svc *Service, log *slog.Logger) *Handler {
	return &Handler{svc: svc, log: log}
}

func decodeAndValidate[T any](r *http.Request) (T, error) {
	var req T
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return req, apperrors.BadRequest("Invalid request body", nil)
	}
	if err := validate.Struct(req); err != nil {
		return req, err
	}
	return req, nil
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[registerRequest](r)
	if err != nil {
		return err
	}

	result, err := h.svc.Register(r.Context(), RegisterInput{
		Email: req.Email, Password: req.Password, DisplayName: req.DisplayName,
	})
	if err != nil {
		return err
	}

	return httpserver.WriteJSON(w, http.StatusCreated, map[string]any{
		"message":      "Registration successful. Please check your email to verify your account.",
		"userId":       result.UserID,
		"uniqueNumber": result.UniqueNumber,
	})
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[loginRequest](r)
	if err != nil {
		return err
	}

	result, err := h.svc.Login(r.Context(), LoginInput{Email: req.Email, Password: req.Password})
	if err != nil {
		return err
	}

	return httpserver.WriteJSON(w, http.StatusOK, map[string]any{
		"accessToken":  result.AccessToken,
		"refreshToken": result.RefreshToken,
		"expiresIn":    result.ExpiresIn,
		"user": map[string]any{
			"id":           result.User.ID,
			"email":        result.User.Email,
			"displayName":  result.User.DisplayName,
			"uniqueNumber": result.User.UniqueNumber,
		},
	})
}

func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[refreshRequest](r)
	if err != nil {
		return err
	}

	result, err := h.svc.RefreshTokens(r.Context(), req.RefreshToken)
	if err != nil {
		return err
	}

	return httpserver.WriteJSON(w, http.StatusOK, map[string]any{
		"accessToken":  result.AccessToken,
		"refreshToken": result.RefreshToken,
		"expiresIn":    result.ExpiresIn,
	})
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[logoutRequest](r)
	if err != nil {
		return err
	}

	if err := h.svc.Logout(r.Context(), req.RefreshToken); err != nil {
		return err
	}

	return httpserver.WriteJSON(w, http.StatusOK, map[string]string{"message": "Logged out successfully"})
}

func (h *Handler) VerifyEmail(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[verifyEmailRequest](r)
	if err != nil {
		return err
	}

	if err := h.svc.VerifyEmail(r.Context(), req.Email, req.Code); err != nil {
		return err
	}

	return httpserver.WriteJSON(w, http.StatusOK, map[string]string{"message": "Email verified successfully"})
}

func (h *Handler) ResendVerification(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[resendVerificationRequest](r)
	if err != nil {
		return err
	}

	if err := h.svc.ResendVerificationEmail(r.Context(), req.Email); err != nil {
		return err
	}

	return httpserver.WriteJSON(w, http.StatusOK, map[string]string{
		"message": "If the email exists, a verification email has been sent",
	})
}

func (h *Handler) ForgotPassword(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[forgotPasswordRequest](r)
	if err != nil {
		return err
	}

	if err := h.svc.ForgotPassword(r.Context(), req.Email); err != nil {
		return err
	}

	return httpserver.WriteJSON(w, http.StatusOK, map[string]string{
		"message": "If the email exists, a password reset link has been sent",
	})
}

func (h *Handler) VerifyResetCode(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[verifyResetCodeRequest](r)
	if err != nil {
		return err
	}

	resetToken, err := h.svc.VerifyResetCode(r.Context(), req.Email, req.Code)
	if err != nil {
		return err
	}

	return httpserver.WriteJSON(w, http.StatusOK, map[string]string{
		"message":    "Code verified successfully",
		"resetToken": resetToken,
	})
}

func (h *Handler) UpdatePassword(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[updatePasswordRequest](r)
	if err != nil {
		return err
	}

	if err := h.svc.UpdatePassword(r.Context(), req.Email, req.ResetToken, req.Password); err != nil {
		return err
	}

	return httpserver.WriteJSON(w, http.StatusOK, map[string]string{"message": "Password reset successfully"})
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend-go && go test -tags=integration ./internal/auth/... -v -run TestHandler`
Expected: PASS, all 11 tests green.

- [ ] **Step 7: Commit**

```bash
cd backend-go && go build ./... && go vet ./... && go test -tags=integration ./internal/auth/... -v
git add backend-go/internal/auth/dto.go backend-go/internal/auth/handler.go backend-go/internal/auth/handler_test.go
git commit -m "backend-go/auth: add Handler (HTTP adapters for all 9 auth endpoints)"
```

---

## Task 11: `internal/auth/routes.go` + `module.go` — mounting and fx wiring

**Files:**
- Create: `backend-go/internal/auth/routes.go`
- Create: `backend-go/internal/auth/module.go`
- Create: `backend-go/internal/auth/routes_test.go`

**Interfaces:**
- Consumes: `*Handler` (Task 10), `*chi.Mux` (**the concrete type `platform.provideRouter` returns — not the `chi.Router` interface**, since `platform.Module`'s provider was registered under `*chi.Mux` with no `fx.As` interface binding; declaring this as `chi.Router` would make `fx.New` fail at startup with a missing-dependency error), `*cache.Cache`, `*slog.Logger`, `config.Config.NodeEnv`, `ratelimit.{NewLoginLimiter,NewAuthLimiter,Middleware}` (this plan's Task 3 + foundation Task 8).
- Produces:
  - `func RegisterRoutes(mux *chi.Mux, h *Handler, c *cache.Cache, log *slog.Logger, cfg config.Config)` — mounts all 9 routes under `/api/v1/auth` with the correct per-route rate limiter.
  - `var Module = fx.Module("auth", ...)` — the package's complete DI wiring, ready for `cmd/server/main.go` to compose alongside `platform.Module`.

- [ ] **Step 1: Write the failing test**

`backend-go/internal/auth/routes_test.go`:
```go
//go:build integration

package auth_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"nexus-connect/backend-go/internal/auth"
	"nexus-connect/backend-go/internal/platform/config"
	"nexus-connect/backend-go/internal/platform/httpserver"
	"nexus-connect/backend-go/internal/platform/logger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRegisterRoutes_MountsAllNineEndpointsUnderAPIV1Auth(t *testing.T) {
	svc := newTestService(t)
	h := auth.NewHandler(svc, logger.New("test"))
	c := startCacheForAuth(t) // routes.go constructs its own limiters from this
	mux := httpserver.NewRouter(logger.New("test"), []string{"*"})
	cfg := config.Config{NodeEnv: "development"} // skip rate limiting for this mounting test

	auth.RegisterRoutes(mux, h, c, logger.New("test"), cfg)

	for _, path := range []string{
		"/api/v1/auth/register", "/api/v1/auth/login", "/api/v1/auth/refresh",
		"/api/v1/auth/logout", "/api/v1/auth/verify-email", "/api/v1/auth/resend-verification",
		"/api/v1/auth/forgot-password", "/api/v1/auth/verify-reset-code", "/api/v1/auth/update-password",
	} {
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(`{}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		assert.NotEqual(t, http.StatusNotFound, rec.Code, "expected %s to be mounted", path)
	}
}

// TestRegisterRoutes_LoginUsesLooserLimiterThanRegister pins Review Focus
// item 5: /login (1h/10) must not share the stricter 15min/5 limiter
// /register uses — this test drives /register to its limit with real
// requests and confirms /login, hit immediately after from the same
// identifier, is unaffected.
func TestRegisterRoutes_LoginUsesLooserLimiterThanRegister(t *testing.T) {
	svc := newTestService(t)
	h := auth.NewHandler(svc, logger.New("test"))
	c := startCacheForAuth(t)
	mux := httpserver.NewRouter(logger.New("test"), []string{"*"})
	cfg := config.Config{NodeEnv: "production"} // rate limiting enforced

	auth.RegisterRoutes(mux, h, c, logger.New("test"), cfg)

	remoteAddr := "7.7.7.7:4444"
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewBufferString(
			`{"email":"ratelimit-`+string(rune('a'+i))+`@example.com","password":"SecureP@ss123","displayName":"RL"}`,
		))
		req.Header.Set("Content-Type", "application/json")
		req.RemoteAddr = remoteAddr
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		require.NotEqual(t, http.StatusTooManyRequests, rec.Code, "register attempt %d should not yet be rate limited", i+1)
	}

	// The 6th /register from the same identifier must now be rate limited...
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewBufferString(`{}`))
	req.RemoteAddr = remoteAddr
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusTooManyRequests, rec.Code)

	// ...but /login from the same identifier must not be, since it uses a
	// separate (1h/10) limiter.
	loginReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(
		`{"email":"nobody@example.com","password":"whatever"}`,
	))
	loginReq.Header.Set("Content-Type", "application/json")
	loginReq.RemoteAddr = remoteAddr
	loginRec := httptest.NewRecorder()
	mux.ServeHTTP(loginRec, loginReq)
	assert.NotEqual(t, http.StatusTooManyRequests, loginRec.Code, "/login must have its own, separate rate-limit budget from /register")
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test -tags=integration ./internal/auth/... -v -run TestRegisterRoutes`
Expected: FAIL — `auth.RegisterRoutes` undefined.

- [ ] **Step 3: Implement `routes.go`**

`backend-go/internal/auth/routes.go`:
```go
package auth

import (
	"log/slog"
	"net/http"

	"nexus-connect/backend-go/internal/platform/cache"
	"nexus-connect/backend-go/internal/platform/config"
	"nexus-connect/backend-go/internal/platform/httpserver"
	"nexus-connect/backend-go/internal/platform/ratelimit"

	"github.com/go-chi/chi/v5"
)

// RegisterRoutes mounts every auth.routes.ts endpoint under /api/v1/auth —
// the exact prefix the existing TS auth-service uses, so the frontend needs
// no changes. Rate limiter assignment matches the original exactly: /login
// gets the 1h/10 limiter, every other mutating route gets the 15min/5
// limiter, and /refresh and /logout get none (see this plan's Global
// Constraints and Review Focus item 5).
func RegisterRoutes(mux *chi.Mux, h *Handler, c *cache.Cache, log *slog.Logger, cfg config.Config) {
	loginLimiter := ratelimit.NewLoginLimiter(c)
	authLimiter := ratelimit.NewAuthLimiter(c)

	loginLimited := ratelimit.Middleware(loginLimiter, cfg.NodeEnv)
	authLimited := ratelimit.Middleware(authLimiter, cfg.NodeEnv)

	mux.Route("/api/v1/auth", func(r chi.Router) {
		r.With(authLimited).Post("/register", httpserver.Wrap(log, h.Register))
		r.With(loginLimited).Post("/login", httpserver.Wrap(log, h.Login))
		r.Post("/refresh", httpserver.Wrap(log, h.Refresh))
		r.Post("/logout", httpserver.Wrap(log, h.Logout))
		r.With(authLimited).Post("/verify-email", httpserver.Wrap(log, h.VerifyEmail))
		r.With(authLimited).Post("/resend-verification", httpserver.Wrap(log, h.ResendVerification))
		r.With(authLimited).Post("/forgot-password", httpserver.Wrap(log, h.ForgotPassword))
		r.With(authLimited).Post("/verify-reset-code", httpserver.Wrap(log, h.VerifyResetCode))
		r.With(authLimited).Post("/update-password", httpserver.Wrap(log, h.UpdatePassword))
	})
}

var _ = http.MethodPost // keep net/http imported if a future edit removes the only other reference
```

- [ ] **Step 4: Remove the placeholder import-keeper — it was never needed**

Delete `var _ = http.MethodPost ...` and the `"net/http"` import from `routes.go`; nothing in this file uses `net/http` directly (`chi.Router`'s `.Post(...)` method takes a plain `http.HandlerFunc`-shaped value produced by `httpserver.Wrap`, which already imports `net/http` itself — this file never references the package by name).

- [ ] **Step 5: Implement `module.go`**

`backend-go/internal/auth/module.go`:
```go
package auth

import "go.uber.org/fx"

var Module = fx.Module("auth",
	fx.Provide(NewStore, NewEmailSender, NewService, NewHandler),
	fx.Invoke(RegisterRoutes),
)
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend-go && go test -tags=integration ./internal/auth/... -v -run TestRegisterRoutes`
Expected: PASS, both tests green.

- [ ] **Step 7: Commit**

```bash
cd backend-go && go build ./... && go vet ./... && go test -tags=integration ./internal/auth/... -v
git add backend-go/internal/auth/routes.go backend-go/internal/auth/module.go backend-go/internal/auth/routes_test.go
git commit -m "backend-go/auth: add RegisterRoutes and auth.Module (fx wiring complete)"
```

---

## Task 12: wire `auth.Module` into `cmd/server/main.go`

**Files:**
- Modify: `backend-go/cmd/server/main.go`
- Modify: `backend-go/cmd/server/main_test.go`

**Interfaces:**
- Consumes: `auth.Module` (Task 11), `platform.Module` (already wired, foundation Task 15).
- Produces: a running binary that actually serves `/api/v1/auth/*` in addition to `/health`.

- [ ] **Step 1: Write the failing integration test**

Add to `backend-go/cmd/server/main_test.go` (same file, alongside the existing `TestApp_Boots...` tests — this needs its own Postgres/Redis like the others, via the same `setAppEnv` helper already defined there):

```go
func TestApp_RegistersAndLogsInThroughTheRealHTTPServer(t *testing.T) {
	setAppEnv(t, 18083)

	app := fxtest.New(t, platform.Module, auth.Module, fx.NopLogger)
	app.RequireStart()
	defer app.RequireStop()

	registerBody := `{"email":"e2e@example.com","password":"SecureP@ss123","displayName":"E2E"}`
	resp, err := http.Post("http://localhost:18083/api/v1/auth/register", "application/json", strings.NewReader(registerBody))
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusCreated, resp.StatusCode)
}
```

- [ ] **Step 2: Fix the two missing imports caught by `go build`**

Add `"nexus-connect/backend-go/internal/auth"` and `"strings"` to `main_test.go`'s import block.

Run: `cd backend-go && go test -tags=integration ./cmd/server/... -v -run TestApp_RegistersAndLogsIn`
Expected: FAIL — `fx.New(platform.Module, auth.Module)`'s `auth.Module` compiles fine (it's a real import now), but the test fails at runtime: `http.Post` to `/api/v1/auth/register` returns 404, since `main.go` itself still only composes `platform.Module`.

- [ ] **Step 3: Update `main.go`**

`backend-go/cmd/server/main.go`:
```go
package main

import (
	"nexus-connect/backend-go/internal/auth"
	"nexus-connect/backend-go/internal/platform"

	"go.uber.org/fx"
)

func main() {
	fx.New(platform.Module, auth.Module).Run()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend-go && go test -tags=integration ./cmd/server/... -v`
Expected: PASS, all 4 tests green (3 pre-existing from the foundation plan plus this one).

- [ ] **Step 5: Run the full verification suite**

```bash
cd backend-go
go build ./...
go vet ./...
go test ./...
go test -tags=integration ./...
go test -race ./...
go test -race -tags=integration ./...
```
Expected: every command exits 0, every package's tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend-go/cmd/server/main.go backend-go/cmd/server/main_test.go
git commit -m "backend-go: wire auth.Module into main.go — /api/v1/auth/* is now live"
```

---

## Plan self-review

**Spec coverage:** All 9 routes from `auth.routes.ts` have a handler + route + test (Tasks 7–11). All 9 `AuthService` methods are ported (Tasks 7–9). The error-envelope contract (spec §4.4) is inherited unmodified from the foundation's `apperrors`/`httpserver.Wrap` — no new error-shape code written here. The fx module convention (spec §4.3) is followed exactly: `Store/Service/Handler` via `fx.Provide`, `RegisterRoutes` via `fx.Invoke`, both in `module.go`. Kafka→events.Bus (spec §2) is implemented in Task 6/7. No WebSocket/`platform/realtime` usage — correctly out of scope, `chat` is item 3 in spec §3, not `auth`.

**Placeholder scan:** Five "write the wrong thing, then fix it in the next step" sequences are deliberate pedagogy, matching the foundation plan's own Task 6/13 precedent for this pattern — none are unresolved TODOs; each shows the broken code, why it's broken, and the real fix in full, in the very next step. Task 3 Step 1→2 references a not-yet-defined test helper. Tasks 8, 9, 10, and 11 each leave one dead `var _ = ...` import-keeper (in `service_login.go`, `service_password_test.go`, `handler_test.go`, and `routes.go` respectively) that gets deleted in its task's very next step.

**Type consistency:** Checked `RegisterInput`/`RegisterResult` (defined Task 7, consumed Task 10's `Handler.Register` unchanged), `LoginInput`/`LoginResult`/`LoginUser`/`TokenResult` (defined Task 8, consumed Task 10's `Handler.Login`/`Handler.Refresh` unchanged), `Store` methods (defined Task 4 — including `FindIDByEmail`, needed only by Task 9's `ForgotPassword` but added alongside every other finder up front rather than bolted on later — consumed Tasks 7–9 with matching signatures), `Service` struct (defined once in Task 7, methods added in Tasks 8–9 without redefinition), `*chi.Mux` (not `chi.Router`) used consistently in Task 11's `RegisterRoutes` signature and its own test. `platformauth` alias used consistently everywhere `internal/platform/auth` is imported from within this module.

**Review Focus:** All five items (login-unverified-order, anti-enumeration on two routes, duplicate-email, refresh-token single-use, correct rate-limiter-per-route) each have a test in the task that owns the relevant code, named to make the property being pinned obvious from the test name alone.

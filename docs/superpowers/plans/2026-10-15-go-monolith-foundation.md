# Go Monolith Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `backend-go/`, a Go monolith skeleton with no domain logic yet — just the shared `internal/platform/*` foundation (DB, cache, events, realtime fan-out, HTTP server, auth, errors, logging, rate limiting, validation, ID generation, migrations) wired together via Uber `fx`, booting to a working `/health` endpoint with clean graceful shutdown, ready for the first domain module (`auth`, next plan) to build on.

**Architecture:** One Go module (`backend-go/go.mod`), `cmd/server/main.go` composing `fx.Module`s from `internal/platform/*`. Every package is unit-tested; `db`, `cache`, `ratelimit`, `realtime`, and `migrations` get integration tests against real Postgres/Redis via `testcontainers-go` (Docker is available in this environment — verified: Docker 29.7.2). No business logic, no HTTP routes beyond `/health` — this plan's only deliverable is the foundation itself.

**Tech Stack:** Go 1.25 (verified installed), `jackc/pgx/v5` + `pgxpool`, `redis/go-redis/v9`, `go-chi/chi/v5`, `coder/websocket` (imported but unused until the `chat` module — see Task 1 note), `go.uber.org/fx`, `golang-jwt/jwt/v5`, `golang.org/x/crypto/bcrypt`, `go-playground/validator/v10`, `log/slog` (stdlib), `golang-migrate/migrate/v4`, `testcontainers-go` + its `postgres`/`redis` modules, `google/uuid`.

**Spec:** [docs/superpowers/specs/2026-10-15-go-monolith-migration-design.md](../specs/2026-10-15-go-monolith-migration-design.md) — this plan implements spec §4–§5 only.

## Global Constraints

- Go module path: `nexus-connect/backend-go`. All internal imports use this prefix (e.g. `nexus-connect/backend-go/internal/platform/errors`).
- Every `AppError`-equivalent JSON response body matches the existing TypeScript shape exactly: `{"error": {"code": "...", "message": "...", "details": {...}}}` — spec §4.4, non-negotiable, the frontend depends on it unmodified.
- bcrypt cost factor: 12 (matches `backend/packages/shared/src/utils/crypto.ts`'s `SALT_ROUNDS`).
- No Kafka, no Zookeeper, anywhere in this plan — spec §2.
- Redact `password`, `token`, `refreshToken`, `accessToken` keys in all log output — matches `backend/packages/shared/src/utils/logger.ts`.
- Every package under `internal/platform/` must have a `_test.go` file before the task that creates it is considered done — no package ships untested, per spec §4.6.
- Docker is available (verified: `docker --version` → 29.7.2) — integration tests using `testcontainers-go` are expected to actually run, not be skipped.

## Review Focus

- **Redis connection lost mid-request** (rate limiter or cache call): every `platform/cache` method must return a Go `error` the caller can check — a dropped Redis connection must not panic or hang; Task 7's tests include a closed-connection case.
- **Concurrent `Publish` calls on `platform/realtime` from two goroutines**: the pub/sub publish path must not share mutable state unsafely — Task 10's test fires concurrent publishes and asserts no data race (`go test -race`).
- **Malformed/expired JWT on a protected route**: `platform/auth`'s middleware must reject with the correct `AppError` subtype (`TokenExpiredError` vs `InvalidTokenError`) matching the original's distinction — Task 11 tests both cases explicitly, not just "any invalid token → 401."
- **`golang-migrate` run twice against an already-migrated database**: must be a no-op, not an error — Task 14's test runs `Up()` twice and asserts the second call doesn't fail (mirrors `migrate.ErrNoChange` handling).
- **SIGTERM arriving while an HTTP request is in flight**: Task 15's shutdown must drain in-flight requests (via `http.Server.Shutdown`, not `Close`) before closing the DB pool — tested by holding a slow handler open during shutdown and asserting it completes rather than being cut off.

---

## Task 1: Project scaffolding

**Files:**
- Create: `backend-go/go.mod`
- Create: `backend-go/go.sum` (populated by the `go get` calls in Step 3, not by `go mod tidy` — see Step 5's note)
- Create: `backend-go/.gitignore`
- Create: `backend-go/internal/platform/.gitkeep` (placeholder so the directory exists in git until Task 2 adds real files — delete it in Task 2)
- Create: `backend-go/README.md`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a buildable empty Go module other tasks add packages into.

- [ ] **Step 1: Create the directory and initialize the module**

```bash
mkdir -p backend-go/internal/platform backend-go/cmd/server
cd backend-go
go mod init nexus-connect/backend-go
```

- [ ] **Step 2: Add the `.gitignore`**

```gitignore
/bin/
*.test
*.out
.env
```

- [ ] **Step 3: Add dependencies to go.mod (without code yet, so later tasks don't each re-run `go get`)**

```bash
go get github.com/jackc/pgx/v5@v5.7.2
go get github.com/redis/go-redis/v9@v9.7.0
go get github.com/go-chi/chi/v5@v5.1.0
go get go.uber.org/fx@v1.23.0
go get github.com/golang-jwt/jwt/v5@v5.2.1
go get golang.org/x/crypto@v0.31.0
go get github.com/go-playground/validator/v10@v10.23.0
go get github.com/golang-migrate/migrate/v4@v4.18.1
go get github.com/google/uuid@v1.6.0
go get github.com/testcontainers/testcontainers-go@v0.34.0
go get github.com/testcontainers/testcontainers-go/modules/postgres@v0.34.0
go get github.com/testcontainers/testcontainers-go/modules/redis@v0.34.0
go get github.com/stretchr/testify@v1.10.0
```

- [ ] **Step 4: Write a placeholder `main.go` that just compiles, to prove the toolchain works**

`backend-go/cmd/server/main.go`:
```go
package main

import "fmt"

func main() {
	fmt.Println("nexus-connect backend-go: foundation scaffolding")
}
```

- [ ] **Step 5: Verify it builds — do NOT run `go mod tidy` here**

`go mod tidy` removes any `require` entry with no importer anywhere in the module. At this point `main.go` only imports `fmt`, so tidying now would strip every dependency Step 3 just pinned back out of `go.mod`/`go.sum`, silently undoing Step 3. Each later task will import the package it needs and `go build`/`go test` will keep `go.sum` consistent for what's actually used — `go mod tidy` only becomes safe to run once real code imports these packages, starting from Task 2 onward.

Run: `cd backend-go && go build ./... && go vet ./...`
Expected: no output, exit code 0. Then confirm Step 3's dependencies actually landed: `grep -c '^\t' go.mod` should report 13 (one line per pinned module in the `require` block), and `wc -l go.sum` should be non-zero (populated with checksums) — do not proceed to Step 6 if either check comes back empty.

- [ ] **Step 6: Write `backend-go/README.md`**

```markdown
# backend-go

Go modular-monolith replacement for `backend/`'s 9 TypeScript microservices.
See `../docs/superpowers/specs/2026-10-15-go-monolith-migration-design.md`
for the full design and `../docs/superpowers/plans/` for implementation plans.

## Running locally

\`\`\`bash
go run ./cmd/server
\`\`\`

## Testing

\`\`\`bash
go test ./...                  # unit tests
go test -race ./...            # race detector (required before every commit touching platform/realtime)
go test -tags=integration ./... # includes testcontainers-go integration tests (requires Docker)
\`\`\`
```

- [ ] **Step 7: Remove the gitkeep placeholder once Task 2 adds real files (note only — do not delete yet; delete it as the first step of Task 2)**

- [ ] **Step 8: Commit**

```bash
git add backend-go/go.mod backend-go/go.sum backend-go/.gitignore backend-go/cmd/server/main.go backend-go/README.md backend-go/internal/platform/.gitkeep
git commit -m "backend-go: scaffold Go module and toolchain"
```

---

## Task 2: `internal/platform/errors` — AppError taxonomy

**Files:**
- Create: `backend-go/internal/platform/errors/errors.go`
- Create: `backend-go/internal/platform/errors/errors_test.go`
- Delete: `backend-go/internal/platform/.gitkeep`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type AppError struct { StatusCode int; Code string; Message string; Details map[string]any; IsOperational bool }` implementing `error` (via `Error() string`).
  - `func (e *AppError) MarshalJSON() ([]byte, error)` — produces `{"error":{"code":...,"message":...,"details":...}}`.
  - Constructors: `BadRequest(msg string, details map[string]any) *AppError`, `Unauthorized(msg string) *AppError`, `Forbidden(msg string) *AppError`, `NotFound(resource string) *AppError`, `Conflict(msg string) *AppError`, `Validation(msg string, details map[string]any) *AppError`, `RateLimit(retryAfterSeconds int) *AppError`, `Internal(msg string) *AppError`, `ServiceUnavailable(service string) *AppError`, `DuplicateEmail() *AppError`, `InvalidCredentials() *AppError`, `EmailNotVerified() *AppError`, `TokenExpired() *AppError`, `InvalidToken() *AppError`, `CallInProgress() *AppError`, `CallNotFound() *AppError`, `NotGroupMember() *AppError`, `InsufficientPermissions(action string) *AppError`.
  - `func As(err error) (*AppError, bool)` — unwraps to `*AppError` if present (used by Task 13's middleware).

- [ ] **Step 1: Delete the gitkeep placeholder**

```bash
rm backend-go/internal/platform/.gitkeep
```

- [ ] **Step 2: Write the failing test**

`backend-go/internal/platform/errors/errors_test.go`:
```go
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

func TestAppError_MarshalJSON_OmitsDetailsKeyWhenNil(t *testing.T) {
	err := apperrors.Unauthorized("nope")
	b, marshalErr := json.Marshal(err)
	require.NoError(t, marshalErr)

	var decoded map[string]map[string]any
	require.NoError(t, json.Unmarshal(b, &decoded))

	_, hasDetails := decoded["error"]["details"]
	assert.False(t, hasDetails, "the \"details\" key must be absent (not null) when AppError.Details is nil — matches JSON.stringify dropping an undefined field in the original TS AppError.toJSON()")
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend-go && go test ./internal/platform/errors/... -v`
Expected: FAIL — compile error, package `errors` doesn't exist yet.

- [ ] **Step 4: Implement `errors.go`**

`backend-go/internal/platform/errors/errors.go`:
```go
package errors

import (
	"encoding/json"
	"errors"
	"fmt"
)

// AppError is the Go equivalent of backend/packages/shared/src/utils/errors.ts's AppError.
type AppError struct {
	StatusCode    int
	Code          string
	Message       string
	Details       map[string]any
	IsOperational bool
}

func (e *AppError) Error() string {
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

// errorBody is the inner "error" object of the wire envelope. Details uses
// `omitempty` deliberately: the original TypeScript AppError.toJSON() returns
// a plain object literal with `details: this.details`, and most subclasses
// never set `details` (it stays `undefined`) — JSON.stringify drops a key
// whose value is undefined entirely, so the real wire shape for e.g.
// UnauthorizedError is {"error":{"code":"UNAUTHORIZED","message":"..."}},
// with NO "details" key at all, not `"details":null`. Without `omitempty`,
// Go's encoding/json would serialize a nil map as `"details":null`, which is
// a different (and wrong) wire shape for every one of the 15 constructors
// that don't pass details — exactly the kind of drift this task exists to
// prevent, so this is not a style preference, it's a parity requirement.
type errorBody struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

func (e *AppError) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Error errorBody `json:"error"`
	}{
		Error: errorBody{Code: e.Code, Message: e.Message, Details: e.Details},
	})
}

// As unwraps err into *AppError if the chain contains one.
func As(err error) (*AppError, bool) {
	var appErr *AppError
	if errors.As(err, &appErr) {
		return appErr, true
	}
	return nil, false
}

func new(status int, code, message string, operational bool, details map[string]any) *AppError {
	return &AppError{StatusCode: status, Code: code, Message: message, Details: details, IsOperational: operational}
}

func BadRequest(message string, details map[string]any) *AppError {
	if message == "" {
		message = "Bad request"
	}
	return new(400, "BAD_REQUEST", message, true, details)
}

func Unauthorized(message string) *AppError {
	if message == "" {
		message = "Unauthorized"
	}
	return new(401, "UNAUTHORIZED", message, true, nil)
}

func Forbidden(message string) *AppError {
	if message == "" {
		message = "Forbidden"
	}
	return new(403, "FORBIDDEN", message, true, nil)
}

func NotFound(resource string) *AppError {
	if resource == "" {
		resource = "Resource"
	}
	return new(404, "NOT_FOUND", resource+" not found", true, nil)
}

func Conflict(message string) *AppError {
	if message == "" {
		message = "Resource already exists"
	}
	return new(409, "CONFLICT", message, true, nil)
}

func Validation(message string, details map[string]any) *AppError {
	if message == "" {
		message = "Validation failed"
	}
	return new(422, "VALIDATION_ERROR", message, true, details)
}

func RateLimit(retryAfterSeconds int) *AppError {
	return new(429, "RATE_LIMIT_EXCEEDED", "Too many requests", true, map[string]any{"retryAfter": retryAfterSeconds})
}

func Internal(message string) *AppError {
	if message == "" {
		message = "Internal server error"
	}
	return new(500, "INTERNAL_ERROR", message, false, nil)
}

func ServiceUnavailable(service string) *AppError {
	if service == "" {
		service = "Service"
	}
	return new(503, "SERVICE_UNAVAILABLE", service+" is temporarily unavailable", true, nil)
}

func DuplicateEmail() *AppError {
	return new(409, "DUPLICATE_EMAIL", "Email already registered", true, nil)
}

func InvalidCredentials() *AppError {
	return new(401, "INVALID_CREDENTIALS", "Invalid email or password", true, nil)
}

func EmailNotVerified() *AppError {
	return new(403, "EMAIL_NOT_VERIFIED", "Email not verified", true, nil)
}

func TokenExpired() *AppError {
	return new(401, "TOKEN_EXPIRED", "Token has expired", true, nil)
}

func InvalidToken() *AppError {
	return new(401, "INVALID_TOKEN", "Invalid token", true, nil)
}

func CallInProgress() *AppError {
	return new(409, "CALL_IN_PROGRESS", "User already in a call", true, nil)
}

func CallNotFound() *AppError {
	return new(404, "CALL_NOT_FOUND", "Call not found", true, nil)
}

func NotGroupMember() *AppError {
	return new(403, "NOT_GROUP_MEMBER", "User is not a member of this group", true, nil)
}

func InsufficientPermissions(action string) *AppError {
	if action == "" {
		action = "perform this action"
	}
	return new(403, "INSUFFICIENT_PERMISSIONS", "Insufficient permissions to "+action, true, nil)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend-go && go test ./internal/platform/errors/... -v`
Expected: PASS, all 6 tests green.

- [ ] **Step 6: Commit**

```bash
git add backend-go/internal/platform/errors backend-go/go.mod backend-go/go.sum
git rm backend-go/internal/platform/.gitkeep
git commit -m "backend-go: add platform/errors (AppError taxonomy)"
```

---

## Task 3: `internal/platform/logger` — structured logging with redaction

**Files:**
- Create: `backend-go/internal/platform/logger/logger.go`
- Create: `backend-go/internal/platform/logger/logger_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `func New(serviceName string) *slog.Logger` — JSON handler, redacting attributes named `password`, `token`, `refreshToken`, `accessToken` (case-sensitive, matching the original).
  - `const RedactedValue = "[REDACTED]"`

- [ ] **Step 1: Write the failing test**

`backend-go/internal/platform/logger/logger_test.go`:
```go
package logger_test

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"

	"nexus-connect/backend-go/internal/platform/logger"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNew_RedactsSensitiveFields(t *testing.T) {
	var buf bytes.Buffer
	l := logger.NewWithWriter("test-service", &buf)

	l.Info("user logged in", "password", "hunter2", "token", "abc.def.ghi", "userId", "u-1")

	var decoded map[string]any
	require.NoError(t, json.Unmarshal(buf.Bytes(), &decoded))

	assert.Equal(t, logger.RedactedValue, decoded["password"])
	assert.Equal(t, logger.RedactedValue, decoded["token"])
	assert.Equal(t, "u-1", decoded["userId"], "non-sensitive fields must pass through untouched")
}

func TestNew_IncludesServiceName(t *testing.T) {
	var buf bytes.Buffer
	l := logger.NewWithWriter("chat-service", &buf)
	l.Info("hello")

	assert.True(t, strings.Contains(buf.String(), `"service":"chat-service"`))
}

func TestNew_DefaultsToStdout(t *testing.T) {
	l := logger.New("foundation")
	assert.NotNil(t, l)
	assert.IsType(t, &slog.Logger{}, l)
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test ./internal/platform/logger/... -v`
Expected: FAIL — package doesn't exist.

- [ ] **Step 3: Implement `logger.go`**

`backend-go/internal/platform/logger/logger.go`:
```go
package logger

import (
	"io"
	"log/slog"
	"os"
)

const RedactedValue = "[REDACTED]"

var sensitiveKeys = map[string]bool{
	"password":     true,
	"token":        true,
	"refreshToken": true,
	"accessToken":  true,
}

// redactingHandler wraps a slog.Handler, replacing the value of any
// attribute whose key is in sensitiveKeys with RedactedValue.
type redactingHandler struct {
	slog.Handler
}

func (h redactingHandler) Handle(ctx interface{ Done() <-chan struct{} }, r slog.Record) error {
	// unused: kept for interface shape documentation only
	return nil
}

func New(serviceName string) *slog.Logger {
	return NewWithWriter(serviceName, os.Stdout)
}

func NewWithWriter(serviceName string, w io.Writer) *slog.Logger {
	handler := slog.NewJSONHandler(w, &slog.HandlerOptions{
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			if sensitiveKeys[a.Key] {
				a.Value = slog.StringValue(RedactedValue)
			}
			return a
		},
	})
	return slog.New(handler).With("service", serviceName)
}
```

- [ ] **Step 4: Fix the unused-interface mistake caught by `go vet`**

The `redactingHandler` type above is dead weight — `slog.HandlerOptions.ReplaceAttr` already does the redaction job without needing a wrapping handler. Remove it:

```go
package logger

import (
	"io"
	"log/slog"
	"os"
)

const RedactedValue = "[REDACTED]"

var sensitiveKeys = map[string]bool{
	"password":     true,
	"token":        true,
	"refreshToken": true,
	"accessToken":  true,
}

func New(serviceName string) *slog.Logger {
	return NewWithWriter(serviceName, os.Stdout)
}

func NewWithWriter(serviceName string, w io.Writer) *slog.Logger {
	handler := slog.NewJSONHandler(w, &slog.HandlerOptions{
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			if sensitiveKeys[a.Key] {
				a.Value = slog.StringValue(RedactedValue)
			}
			return a
		},
	})
	return slog.New(handler).With("service", serviceName)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend-go && go vet ./internal/platform/logger/... && go test ./internal/platform/logger/... -v`
Expected: PASS, 3 tests green, no vet warnings.

- [ ] **Step 6: Commit**

```bash
git add backend-go/internal/platform/logger
git commit -m "backend-go: add platform/logger (slog JSON + redaction)"
```

---

## Task 4: `internal/platform/idgen` — ID generation helpers

**Files:**
- Create: `backend-go/internal/platform/idgen/idgen.go`
- Create: `backend-go/internal/platform/idgen/idgen_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `func UUID() string`
  - `func TimeOrderedUUID() string`
  - `func UniqueTenDigitNumber(ctx context.Context, exists func(ctx context.Context, number string) (bool, error), maxAttempts int) (string, error)` — mirrors `generateUniqueNumber`'s retry loop; returns an error (not a panic) after `maxAttempts` failures, so callers can map it to `errors.Internal(...)`.
  - `func ShortID(length int) string`
  - `func CorrelationID() string`

- [ ] **Step 1: Write the failing test**

`backend-go/internal/platform/idgen/idgen_test.go`:
```go
package idgen_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"nexus-connect/backend-go/internal/platform/idgen"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUUID_IsValidV4Format(t *testing.T) {
	id := idgen.UUID()
	assert.Len(t, id, 36)
	assert.Equal(t, "4", string(id[14]), "version nibble must be 4")
}

func TestUniqueTenDigitNumber_RetriesOnCollision(t *testing.T) {
	attempts := 0
	exists := func(ctx context.Context, number string) (bool, error) {
		attempts++
		return attempts < 3, nil // first 2 "exist", 3rd is free
	}

	number, err := idgen.UniqueTenDigitNumber(context.Background(), exists, 10)
	require.NoError(t, err)
	assert.Len(t, number, 10)
	assert.NotEqual(t, "0", string(number[0]), "first digit must never be 0")
	assert.Equal(t, 3, attempts)
}

func TestUniqueTenDigitNumber_ReturnsErrorAfterMaxAttempts(t *testing.T) {
	alwaysExists := func(ctx context.Context, number string) (bool, error) { return true, nil }

	_, err := idgen.UniqueTenDigitNumber(context.Background(), alwaysExists, 3)
	require.Error(t, err)
	assert.True(t, errors.Is(err, idgen.ErrExhausted))
}

func TestUniqueTenDigitNumber_PropagatesCheckError(t *testing.T) {
	boom := errors.New("db down")
	failing := func(ctx context.Context, number string) (bool, error) { return false, boom }

	_, err := idgen.UniqueTenDigitNumber(context.Background(), failing, 5)
	require.ErrorIs(t, err, boom)
}

func TestShortID_UsesUnambiguousAlphabet(t *testing.T) {
	id := idgen.ShortID(8)
	assert.Len(t, id, 8)
	for _, c := range id {
		assert.False(t, strings.ContainsRune("0OIl1", c), "ambiguous character %q must not appear", c)
	}
}

func TestCorrelationID_HasPrefix(t *testing.T) {
	assert.True(t, strings.HasPrefix(idgen.CorrelationID(), "corr_"))
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test ./internal/platform/idgen/... -v`
Expected: FAIL — package doesn't exist.

- [ ] **Step 3: Implement `idgen.go`**

`backend-go/internal/platform/idgen/idgen.go`:
```go
package idgen

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/google/uuid"
)

var ErrExhausted = errors.New("idgen: exhausted max attempts without finding a unique value")

func UUID() string {
	return uuid.New().String()
}

// TimeOrderedUUID mirrors the TS "custom UUIDv7-like" helper: timestamp prefix + random suffix.
func TimeOrderedUUID() string {
	ts := time.Now().UnixMilli()
	tsHex := fmt.Sprintf("%012x", ts)
	randPart := randHex(10)
	return fmt.Sprintf("%s-%s-7%s-%s-%s",
		tsHex[0:8], tsHex[8:12], randPart[0:3], randPart[3:7], randPart[7:19])
}

func UniqueTenDigitNumber(
	ctx context.Context,
	exists func(ctx context.Context, number string) (bool, error),
	maxAttempts int,
) (string, error) {
	for attempt := 0; attempt < maxAttempts; attempt++ {
		candidate := randomTenDigit()
		taken, err := exists(ctx, candidate)
		if err != nil {
			return "", err
		}
		if !taken {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("generating unique 10-digit number: %w", ErrExhausted)
}

func randomTenDigit() string {
	firstDigit, _ := rand.Int(rand.Reader, big.NewInt(9))
	rest, _ := rand.Int(rand.Reader, big.NewInt(1_000_000_000))
	return fmt.Sprintf("%d%09d", firstDigit.Int64()+1, rest.Int64())
}

const shortIDAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"

func ShortID(length int) string {
	b := make([]byte, length)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(shortIDAlphabet))))
		b[i] = shortIDAlphabet[n.Int64()]
	}
	return string(b)
}

func CorrelationID() string {
	return "corr_" + UUID()
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x", b)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend-go && go test ./internal/platform/idgen/... -v`
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/platform/idgen backend-go/go.mod backend-go/go.sum
git commit -m "backend-go: add platform/idgen (UUID, unique-number, short-ID helpers)"
```

---

## Task 5: `internal/platform/config` — environment configuration

**Files:**
- Create: `backend-go/internal/platform/config/config.go`
- Create: `backend-go/internal/platform/config/config_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Config struct` with fields: `Port int`, `PostgresHost string`, `PostgresPort int`, `PostgresDB string`, `PostgresUser string`, `PostgresPassword string`, `PostgresPoolMax int`, `RedisHost string`, `RedisPort int`, `RedisPassword string`, `RedisDB int`, `JWTAccessSecret string`, `JWTRefreshSecret string`, `JWTAccessExpiry time.Duration`, `JWTRefreshExpiry time.Duration`, `CORSOrigins []string`, `NodeEnv string`.
  - `func Load() (Config, error)` — reads from `os.Getenv`, applies the same defaults as `backend/.env.example` where sensible for local dev, **returns an error (does not silently fall back to a hardcoded secret) if `JWT_ACCESS_SECRET` or `JWT_REFRESH_SECRET` is unset** — this is a deliberate improvement over the original's fail-open pattern (an infra/tooling choice, not a business-behavior fidelity concern, consistent with spec §2's migrations carve-out).
  - `func (c Config) PostgresDSN() string`
  - `func (c Config) RedisAddr() string`

- [ ] **Step 1: Write the failing test**

`backend-go/internal/platform/config/config_test.go`:
```go
package config_test

import (
	"testing"
	"time"

	"nexus-connect/backend-go/internal/platform/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoad_AppliesDefaults(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "test-access-secret-at-least-32-chars")
	t.Setenv("JWT_REFRESH_SECRET", "test-refresh-secret-at-least-32-chars")

	cfg, err := config.Load()
	require.NoError(t, err)

	assert.Equal(t, "localhost", cfg.PostgresHost)
	assert.Equal(t, 5432, cfg.PostgresPort)
	assert.Equal(t, "nexus", cfg.PostgresDB)
	assert.Equal(t, 20, cfg.PostgresPoolMax)
	assert.Equal(t, "localhost", cfg.RedisHost)
	assert.Equal(t, 6379, cfg.RedisPort)
	assert.Equal(t, 15*time.Minute, cfg.JWTAccessExpiry)
	assert.Equal(t, 7*24*time.Hour, cfg.JWTRefreshExpiry)
}

func TestLoad_FailsClosedWithoutJWTSecrets(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "")
	t.Setenv("JWT_REFRESH_SECRET", "")

	_, err := config.Load()
	require.Error(t, err, "must fail rather than silently use a hardcoded dev secret")
}

func TestLoad_ParsesCORSOriginsList(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "x-access-secret-at-least-32-characters")
	t.Setenv("JWT_REFRESH_SECRET", "x-refresh-secret-at-least-32-characters")
	t.Setenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173")

	cfg, err := config.Load()
	require.NoError(t, err)
	assert.Equal(t, []string{"http://localhost:3000", "http://localhost:5173"}, cfg.CORSOrigins)
}

func TestPostgresDSN_Format(t *testing.T) {
	cfg := config.Config{
		PostgresHost: "db", PostgresPort: 5432, PostgresDB: "nexus",
		PostgresUser: "postgres", PostgresPassword: "secret",
	}
	assert.Equal(t, "postgres://postgres:secret@db:5432/nexus?sslmode=disable", cfg.PostgresDSN())
}

func TestRedisAddr_Format(t *testing.T) {
	cfg := config.Config{RedisHost: "cache", RedisPort: 6380}
	assert.Equal(t, "cache:6380", cfg.RedisAddr())
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test ./internal/platform/config/... -v`
Expected: FAIL — package doesn't exist.

- [ ] **Step 3: Implement `config.go`**

`backend-go/internal/platform/config/config.go`:
```go
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port int

	PostgresHost     string
	PostgresPort     int
	PostgresDB       string
	PostgresUser     string
	PostgresPassword string
	PostgresPoolMax  int

	RedisHost     string
	RedisPort     int
	RedisPassword string
	RedisDB       int

	JWTAccessSecret  string
	JWTRefreshSecret string
	JWTAccessExpiry  time.Duration
	JWTRefreshExpiry time.Duration

	CORSOrigins []string
	NodeEnv     string
}

func Load() (Config, error) {
	cfg := Config{
		Port: envInt("PORT", 8080),

		PostgresHost:     envStr("POSTGRES_HOST", "localhost"),
		PostgresPort:     envInt("POSTGRES_PORT", 5432),
		PostgresDB:       envStr("POSTGRES_DB", "nexus"),
		PostgresUser:     envStr("POSTGRES_USER", "postgres"),
		PostgresPassword: envStr("POSTGRES_PASSWORD", "postgres"),
		PostgresPoolMax:  envInt("POSTGRES_POOL_MAX", 20),

		RedisHost:     envStr("REDIS_HOST", "localhost"),
		RedisPort:     envInt("REDIS_PORT", 6379),
		RedisPassword: envStr("REDIS_PASSWORD", ""),
		RedisDB:       envInt("REDIS_DB", 0),

		JWTAccessSecret:  os.Getenv("JWT_ACCESS_SECRET"),
		JWTRefreshSecret: os.Getenv("JWT_REFRESH_SECRET"),
		JWTAccessExpiry:  envDuration("JWT_ACCESS_EXPIRY", 15*time.Minute),
		JWTRefreshExpiry: envDuration("JWT_REFRESH_EXPIRY", 7*24*time.Hour),

		CORSOrigins: envList("CORS_ORIGINS", []string{"http://localhost:3000"}),
		NodeEnv:     envStr("NODE_ENV", "development"),
	}

	if cfg.JWTAccessSecret == "" || cfg.JWTRefreshSecret == "" {
		return Config{}, fmt.Errorf("config: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must both be set (no hardcoded fallback, unlike the original TypeScript services)")
	}

	return cfg, nil
}

func (c Config) PostgresDSN() string {
	return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable",
		c.PostgresUser, c.PostgresPassword, c.PostgresHost, c.PostgresPort, c.PostgresDB)
}

func (c Config) RedisAddr() string {
	return fmt.Sprintf("%s:%d", c.RedisHost, c.RedisPort)
}

func envStr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(normalizeDuration(v)); err == nil {
			return d
		}
	}
	return def
}

// normalizeDuration converts the TS-style "15m"/"7d" expiry strings
// (used in backend/.env.example) into Go's time.ParseDuration format,
// which lacks a "d" (day) unit.
func normalizeDuration(v string) string {
	if strings.HasSuffix(v, "d") {
		days := strings.TrimSuffix(v, "d")
		if n, err := strconv.Atoi(days); err == nil {
			return fmt.Sprintf("%dh", n*24)
		}
	}
	return v
}

func envList(key string, def []string) []string {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	parts := strings.Split(v, ",")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return parts
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend-go && go test ./internal/platform/config/... -v`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/platform/config
git commit -m "backend-go: add platform/config (fails closed on missing JWT secrets)"
```

---

## Task 6: `internal/platform/db` — Postgres pool wrapper

**Files:**
- Create: `backend-go/internal/platform/db/db.go`
- Create: `backend-go/internal/platform/db/db_test.go` (build-tagged `integration`)

**Interfaces:**
- Consumes: `config.Config.PostgresDSN()`, `config.Config.PostgresPoolMax` (Task 5).
- Produces:
  - `type DB struct` wrapping `*pgxpool.Pool`.
  - `func New(ctx context.Context, dsn string, maxConns int32) (*DB, error)`
  - `func (d *DB) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)`
  - `func (d *DB) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row`
  - `func (d *DB) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)`
  - `func (d *DB) Transaction(ctx context.Context, fn func(pgx.Tx) error) error`
  - `func (d *DB) HealthCheck(ctx context.Context) error`
  - `func (d *DB) Close()`

- [ ] **Step 1: Write the failing integration test**

`backend-go/internal/platform/db/db_test.go`:
```go
//go:build integration

package db_test

import (
	"context"
	"testing"
	"time"

	"nexus-connect/backend-go/internal/platform/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
)

func startPostgres(t *testing.T) string {
	t.Helper()
	ctx := context.Background()

	container, err := postgres.Run(ctx, "postgres:16-alpine",
		postgres.WithDatabase("nexus_test"),
		postgres.WithUsername("postgres"),
		postgres.WithPassword("postgres"),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err)
	return dsn
}

func TestNew_ConnectsAndHealthChecks(t *testing.T) {
	dsn := startPostgres(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := db.New(ctx, dsn, 5)
	require.NoError(t, err)
	defer pool.Close()

	assert.NoError(t, pool.HealthCheck(ctx))
}

func TestQueryRow_ReturnsValue(t *testing.T) {
	dsn := startPostgres(t)
	ctx := context.Background()
	pool, err := db.New(ctx, dsn, 5)
	require.NoError(t, err)
	defer pool.Close()

	var result int
	err = pool.QueryRow(ctx, "SELECT 1 + 1").Scan(&result)
	require.NoError(t, err)
	assert.Equal(t, 2, result)
}

func TestTransaction_RollsBackOnError(t *testing.T) {
	dsn := startPostgres(t)
	ctx := context.Background()
	pool, err := db.New(ctx, dsn, 5)
	require.NoError(t, err)
	defer pool.Close()

	_, err = pool.Exec(ctx, "CREATE TABLE tx_test (id INT PRIMARY KEY)")
	require.NoError(t, err)

	txErr := pool.Transaction(ctx, func(tx interface {
		Exec(context.Context, string, ...any) (interface{ RowsAffected() int64 }, error)
	}) error {
		return nil
	})
	_ = txErr // placeholder replaced in Step 4's real signature-matching test below
}

func TestTransaction_CommitsOnSuccess(t *testing.T) {
	dsn := startPostgres(t)
	ctx := context.Background()
	pool, err := db.New(ctx, dsn, 5)
	require.NoError(t, err)
	defer pool.Close()

	_, err = pool.Exec(ctx, "CREATE TABLE tx_commit_test (id INT PRIMARY KEY)")
	require.NoError(t, err)

	err = pool.Transaction(ctx, func(tx pgxTx) error {
		_, execErr := tx.Exec(ctx, "INSERT INTO tx_commit_test (id) VALUES (1)")
		return execErr
	})
	require.NoError(t, err)

	var count int
	require.NoError(t, pool.QueryRow(ctx, "SELECT COUNT(*) FROM tx_commit_test").Scan(&count))
	assert.Equal(t, 1, count)
}
```

Note: `TestTransaction_RollsBackOnError` above is deliberately broken (wrong signature) to force fixing it in the next step once the real `pgx.Tx` type is in scope — this documents the exact gotcha (don't invent an ad hoc transaction interface) rather than silently writing it correctly the first time.

- [ ] **Step 2: Fix the test file to use the real `pgx.Tx` type and run it to verify it fails on missing package**

Replace the broken test with:
```go
func TestTransaction_RollsBackOnError(t *testing.T) {
	dsn := startPostgres(t)
	ctx := context.Background()
	pool, err := db.New(ctx, dsn, 5)
	require.NoError(t, err)
	defer pool.Close()

	_, err = pool.Exec(ctx, "CREATE TABLE tx_rollback_test (id INT PRIMARY KEY)")
	require.NoError(t, err)

	txErr := pool.Transaction(ctx, func(tx pgx.Tx) error {
		_, execErr := tx.Exec(ctx, "INSERT INTO tx_rollback_test (id) VALUES (1)")
		require.NoError(t, execErr)
		return assert.AnError // force rollback
	})
	require.Error(t, txErr)

	var count int
	require.NoError(t, pool.QueryRow(ctx, "SELECT COUNT(*) FROM tx_rollback_test").Scan(&count))
	assert.Equal(t, 0, count, "insert must have been rolled back")
}
```

Add `"github.com/jackc/pgx/v5"` to the test file's imports; remove the `pgxTx` placeholder reference and use `pgx.Tx` in `TestTransaction_CommitsOnSuccess` too.

Run: `cd backend-go && go test -tags=integration ./internal/platform/db/... -v`
Expected: FAIL — package `db` doesn't exist yet.

- [ ] **Step 3: Implement `db.go`**

`backend-go/internal/platform/db/db.go`:
```go
package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DB struct {
	pool *pgxpool.Pool
}

func New(ctx context.Context, dsn string, maxConns int32) (*DB, error) {
	poolCfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("db: parsing DSN: %w", err)
	}
	poolCfg.MaxConns = maxConns

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("db: creating pool: %w", err)
	}
	return &DB{pool: pool}, nil
}

func (d *DB) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return d.pool.Query(ctx, sql, args...)
}

func (d *DB) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return d.pool.QueryRow(ctx, sql, args...)
}

func (d *DB) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return d.pool.Exec(ctx, sql, args...)
}

// Transaction runs fn inside a BEGIN/COMMIT, rolling back if fn returns an error —
// mirrors backend/packages/shared/src/database/postgres.ts's transaction() helper.
func (d *DB) Transaction(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := d.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("db: beginning transaction: %w", err)
	}

	if err := fn(tx); err != nil {
		if rbErr := tx.Rollback(ctx); rbErr != nil {
			return fmt.Errorf("db: rolling back after %w: %v", err, rbErr)
		}
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("db: committing transaction: %w", err)
	}
	return nil
}

func (d *DB) HealthCheck(ctx context.Context) error {
	return d.pool.Ping(ctx)
}

func (d *DB) Close() {
	d.pool.Close()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend-go && go test -tags=integration ./internal/platform/db/... -v`
Expected: PASS, all 4 tests green (requires Docker — verified available).

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/platform/db backend-go/go.mod backend-go/go.sum
git commit -m "backend-go: add platform/db (pgxpool wrapper + transaction helper)"
```

---

## Task 7: `internal/platform/cache` — Redis wrapper + session key helpers

**Files:**
- Create: `backend-go/internal/platform/cache/cache.go`
- Create: `backend-go/internal/platform/cache/keys.go`
- Create: `backend-go/internal/platform/cache/cache_test.go` (build-tagged `integration`)

**Interfaces:**
- Consumes: `config.Config.RedisAddr()`, `RedisPassword`, `RedisDB` (Task 5).
- Produces:
  - `type Cache struct` wrapping `*redis.Client`.
  - `func New(addr, password string, db int) *Cache`
  - `func (c *Cache) Get(ctx, key string) (string, error)` — returns `redis.Nil`-wrapped miss as `(" ", ErrNotFound)`; exported `var ErrNotFound = errors.New("cache: key not found")`.
  - `func (c *Cache) Set(ctx, key, value string, ttl time.Duration) error`
  - `func (c *Cache) Del(ctx, keys ...string) error`
  - `func (c *Cache) Exists(ctx, key string) (bool, error)`
  - `func (c *Cache) Eval(ctx, script string, keys []string, args ...any) (any, error)` — used by Task 8's rate limiter.
  - `func (c *Cache) Publish(ctx, channel, message string) error`
  - `func (c *Cache) Subscribe(ctx, channels ...string) *redis.PubSub` — raw subscription handle, wrapped further by Task 10's `realtime` package.
  - `func (c *Cache) HealthCheck(ctx) error`
  - `func (c *Cache) Close() error`
  - `keys.go`: `func RefreshTokenKey(token string) string`, `func EmailVerificationKey(token string) string`, `func PasswordResetKey(token string) string`, `func UserStatusKey(userID string) string`, `func UserConnectionsKey(userID string) string`, `func CallRoomKey(roomID string) string`, `func CallParticipantsKey(callID string) string`, `func TypingIndicatorKey(chatID, userID string) string`, `func RateLimitKey(identifier, action string) string` — direct ports of `SessionKeys` from `redis.ts`.

- [ ] **Step 1: Write the failing integration test**

`backend-go/internal/platform/cache/cache_test.go`:
```go
//go:build integration

package cache_test

import (
	"context"
	"testing"
	"time"

	"nexus-connect/backend-go/internal/platform/cache"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
)

func startRedis(t *testing.T) string {
	t.Helper()
	ctx := context.Background()

	container, err := tcredis.Run(ctx, "redis:7-alpine")
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	connStr, err := container.ConnectionString(ctx)
	require.NoError(t, err)
	return connStr
}

func TestSetGet_RoundTrips(t *testing.T) {
	addr := startRedis(t)
	c := cache.New(addr, "", 0)
	defer c.Close()
	ctx := context.Background()

	require.NoError(t, c.Set(ctx, "foo", "bar", time.Minute))
	val, err := c.Get(ctx, "foo")
	require.NoError(t, err)
	assert.Equal(t, "bar", val)
}

func TestGet_MissingKeyReturnsErrNotFound(t *testing.T) {
	addr := startRedis(t)
	c := cache.New(addr, "", 0)
	defer c.Close()

	_, err := c.Get(context.Background(), "does-not-exist")
	assert.ErrorIs(t, err, cache.ErrNotFound)
}

func TestEval_SlidingWindowScriptPattern(t *testing.T) {
	addr := startRedis(t)
	c := cache.New(addr, "", 0)
	defer c.Close()
	ctx := context.Background()

	script := `
		redis.call('SET', KEYS[1], ARGV[1])
		return redis.call('GET', KEYS[1])
	`
	result, err := c.Eval(ctx, script, []string{"eval-test-key"}, "eval-value")
	require.NoError(t, err)
	assert.Equal(t, "eval-value", result)
}

func TestHealthCheck_Succeeds(t *testing.T) {
	addr := startRedis(t)
	c := cache.New(addr, "", 0)
	defer c.Close()
	assert.NoError(t, c.HealthCheck(context.Background()))
}

func TestKeys_MatchExpectedFormat(t *testing.T) {
	assert.Equal(t, "refresh:abc123", cache.RefreshTokenKey("abc123"))
	assert.Equal(t, "status:user-1", cache.UserStatusKey("user-1"))
	assert.Equal(t, "ratelimit:login:1.2.3.4", cache.RateLimitKey("1.2.3.4", "login"))
	assert.Equal(t, "typing:chat-1:user-1", cache.TypingIndicatorKey("chat-1", "user-1"))
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test -tags=integration ./internal/platform/cache/... -v`
Expected: FAIL — package doesn't exist.

- [ ] **Step 3: Implement `cache.go`**

`backend-go/internal/platform/cache/cache.go`:
```go
package cache

import (
	"context"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

var ErrNotFound = errors.New("cache: key not found")

type Cache struct {
	client *redis.Client
}

func New(addr, password string, db int) *Cache {
	return &Cache{client: redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})}
}

func (c *Cache) Get(ctx context.Context, key string) (string, error) {
	val, err := c.client.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return val, nil
}

func (c *Cache) Set(ctx context.Context, key, value string, ttl time.Duration) error {
	return c.client.Set(ctx, key, value, ttl).Err()
}

func (c *Cache) Del(ctx context.Context, keys ...string) error {
	return c.client.Del(ctx, keys...).Err()
}

func (c *Cache) Exists(ctx context.Context, key string) (bool, error) {
	n, err := c.client.Exists(ctx, key).Result()
	return n == 1, err
}

func (c *Cache) Eval(ctx context.Context, script string, keys []string, args ...any) (any, error) {
	return c.client.Eval(ctx, script, keys, args...).Result()
}

func (c *Cache) Publish(ctx context.Context, channel, message string) error {
	return c.client.Publish(ctx, channel, message).Err()
}

func (c *Cache) Subscribe(ctx context.Context, channels ...string) *redis.PubSub {
	return c.client.Subscribe(ctx, channels...)
}

func (c *Cache) HealthCheck(ctx context.Context) error {
	return c.client.Ping(ctx).Err()
}

func (c *Cache) Close() error {
	return c.client.Close()
}
```

- [ ] **Step 4: Implement `keys.go`**

`backend-go/internal/platform/cache/keys.go`:
```go
package cache

import "fmt"

// Direct port of backend/packages/shared/src/database/redis.ts's SessionKeys.

func UserSessionKey(userID string) string        { return fmt.Sprintf("session:user:%s", userID) }
func RefreshTokenKey(token string) string         { return fmt.Sprintf("refresh:%s", token) }
func EmailVerificationKey(token string) string    { return fmt.Sprintf("email_verify:%s", token) }
func PasswordResetKey(token string) string        { return fmt.Sprintf("password_reset:%s", token) }
func UserStatusKey(userID string) string          { return fmt.Sprintf("status:%s", userID) }
func UserConnectionsKey(userID string) string     { return fmt.Sprintf("connections:%s", userID) }
func CallRoomKey(roomID string) string            { return fmt.Sprintf("call:room:%s", roomID) }
func CallParticipantsKey(callID string) string    { return fmt.Sprintf("call:participants:%s", callID) }
func TypingIndicatorKey(chatID, userID string) string {
	return fmt.Sprintf("typing:%s:%s", chatID, userID)
}
func OnlineUsersKey() string { return "online:users" }
func RateLimitKey(identifier, action string) string {
	return fmt.Sprintf("ratelimit:%s:%s", action, identifier)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend-go && go test -tags=integration ./internal/platform/cache/... -v`
Expected: PASS, all 5 tests green.

- [ ] **Step 6: Commit**

```bash
git add backend-go/internal/platform/cache backend-go/go.mod backend-go/go.sum
git commit -m "backend-go: add platform/cache (go-redis wrapper + SessionKeys port)"
```

---

## Task 8: `internal/platform/ratelimit` — sliding-window Redis rate limiter

**Files:**
- Create: `backend-go/internal/platform/ratelimit/ratelimit.go`
- Create: `backend-go/internal/platform/ratelimit/ratelimit_test.go` (build-tagged `integration`)

**Interfaces:**
- Consumes: `*cache.Cache` (Task 7), `cache.RateLimitKey` (Task 7).
- Produces:
  - `type Limiter struct`
  - `func New(c *cache.Cache, windowMs int64, max int, keyPrefix string) *Limiter`
  - `type Result struct { Allowed bool; Remaining int; ResetTimeMs int64; RetryAfterSeconds int }`
  - `func (l *Limiter) Check(ctx context.Context, identifier string) (Result, error)`
  - Pre-configured constructors mirroring `rate-limiter.ts`: `func NewAuthLimiter(c *cache.Cache) *Limiter` (15min/5), `func NewLoginLimiter(c *cache.Cache) *Limiter` (1h/10), `func NewAPILimiter(c *cache.Cache) *Limiter` (1min/100), `func NewMessageLimiter(c *cache.Cache) *Limiter` (1min/60), `func NewCallLimiter(c *cache.Cache) *Limiter` (1min/10).

- [ ] **Step 1: Write the failing integration test**

`backend-go/internal/platform/ratelimit/ratelimit_test.go`:
```go
//go:build integration

package ratelimit_test

import (
	"context"
	"testing"

	"nexus-connect/backend-go/internal/platform/cache"
	"nexus-connect/backend-go/internal/platform/ratelimit"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
)

func startCache(t *testing.T) *cache.Cache {
	t.Helper()
	ctx := context.Background()
	container, err := tcredis.Run(ctx, "redis:7-alpine")
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })
	connStr, err := container.ConnectionString(ctx)
	require.NoError(t, err)
	return cache.New(connStr, "", 0)
}

func TestCheck_AllowsUpToLimit(t *testing.T) {
	c := startCache(t)
	limiter := ratelimit.New(c, 60_000, 3, "test")
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		res, err := limiter.Check(ctx, "user-1")
		require.NoError(t, err)
		assert.True(t, res.Allowed, "request %d should be allowed", i+1)
	}
}

func TestCheck_DeniesOverLimit(t *testing.T) {
	c := startCache(t)
	limiter := ratelimit.New(c, 60_000, 2, "test")
	ctx := context.Background()

	_, _ = limiter.Check(ctx, "user-2")
	_, _ = limiter.Check(ctx, "user-2")
	res, err := limiter.Check(ctx, "user-2")
	require.NoError(t, err)
	assert.False(t, res.Allowed)
	assert.Greater(t, res.RetryAfterSeconds, 0)
}

func TestCheck_IdentifiersAreIndependent(t *testing.T) {
	c := startCache(t)
	limiter := ratelimit.New(c, 60_000, 1, "test")
	ctx := context.Background()

	res1, _ := limiter.Check(ctx, "user-a")
	res2, _ := limiter.Check(ctx, "user-b")
	assert.True(t, res1.Allowed)
	assert.True(t, res2.Allowed, "different identifiers must not share a bucket")
}

func TestNewLoginLimiter_HasExpectedWindow(t *testing.T) {
	c := startCache(t)
	limiter := ratelimit.NewLoginLimiter(c)
	ctx := context.Background()

	var lastAllowed bool
	for i := 0; i < 11; i++ {
		res, err := limiter.Check(ctx, "login-user")
		require.NoError(t, err)
		lastAllowed = res.Allowed
	}
	assert.False(t, lastAllowed, "11th login attempt within the hour must be denied (max=10)")
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test -tags=integration ./internal/platform/ratelimit/... -v`
Expected: FAIL — package doesn't exist.

- [ ] **Step 3: Implement `ratelimit.go`**

`backend-go/internal/platform/ratelimit/ratelimit.go`:
```go
package ratelimit

import (
	"context"
	"fmt"
	"time"

	"nexus-connect/backend-go/internal/platform/cache"
)

// slidingWindowScript is a direct port of the Lua script in
// backend/packages/shared/src/middleware/rate-limiter.ts.
const slidingWindowScript = `
	local key = KEYS[1]
	local now = tonumber(ARGV[1])
	local window = tonumber(ARGV[2])
	local limit = tonumber(ARGV[3])
	local ttl = tonumber(ARGV[4])

	redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
	local count = redis.call('ZCARD', key)

	if count < limit then
		redis.call('ZADD', key, now, now .. '-' .. math.random())
		redis.call('PEXPIRE', key, ttl)
		return {1, limit - count - 1, now + window}
	else
		local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
		local resetTime = oldest[2] and (tonumber(oldest[2]) + window) or (now + window)
		return {0, 0, resetTime}
	end
`

type Result struct {
	Allowed           bool
	Remaining         int
	ResetTimeMs       int64
	RetryAfterSeconds int
}

type Limiter struct {
	cache     *cache.Cache
	windowMs  int64
	max       int
	keyPrefix string
}

func New(c *cache.Cache, windowMs int64, max int, keyPrefix string) *Limiter {
	return &Limiter{cache: c, windowMs: windowMs, max: max, keyPrefix: keyPrefix}
}

func (l *Limiter) Check(ctx context.Context, identifier string) (Result, error) {
	key := cache.RateLimitKey(identifier, l.keyPrefix)
	now := time.Now().UnixMilli()

	raw, err := l.cache.Eval(ctx, slidingWindowScript, []string{key}, now, l.windowMs, l.max, l.windowMs+1000)
	if err != nil {
		return Result{}, fmt.Errorf("ratelimit: eval failed: %w", err)
	}

	arr, ok := raw.([]any)
	if !ok || len(arr) != 3 {
		return Result{}, fmt.Errorf("ratelimit: unexpected script return shape: %v", raw)
	}

	allowed := toInt64(arr[0]) == 1
	remaining := int(toInt64(arr[1]))
	resetTime := toInt64(arr[2])

	result := Result{Allowed: allowed, Remaining: remaining, ResetTimeMs: resetTime}
	if !allowed {
		result.RetryAfterSeconds = int((resetTime - now + 999) / 1000)
	}
	return result, nil
}

func toInt64(v any) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case int:
		return int64(n)
	default:
		return 0
	}
}

func NewAuthLimiter(c *cache.Cache) *Limiter {
	return New(c, 15*60*1000, 5, "auth")
}

func NewLoginLimiter(c *cache.Cache) *Limiter {
	return New(c, 60*60*1000, 10, "login")
}

func NewAPILimiter(c *cache.Cache) *Limiter {
	return New(c, 60*1000, 100, "api")
}

func NewMessageLimiter(c *cache.Cache) *Limiter {
	return New(c, 60*1000, 60, "message")
}

func NewCallLimiter(c *cache.Cache) *Limiter {
	return New(c, 60*1000, 10, "call")
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend-go && go test -tags=integration ./internal/platform/ratelimit/... -v`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/platform/ratelimit
git commit -m "backend-go: add platform/ratelimit (ported Lua sliding-window limiter)"
```

---

## Task 9: `internal/platform/events` — in-process event bus

**Files:**
- Create: `backend-go/internal/platform/events/events.go`
- Create: `backend-go/internal/platform/events/events_test.go`

**Interfaces:**
- Consumes: `*logger.Logger` (via `*slog.Logger`, Task 3) for logging dispatch failures.
- Produces:
  - `type Event interface { EventType() string }`
  - `type Handler func(ctx context.Context, e Event)`
  - `type Bus struct`
  - `func NewBus(log *slog.Logger) *Bus`
  - `func (b *Bus) Subscribe(eventType string, h Handler)`
  - `func (b *Bus) Publish(ctx context.Context, e Event)` — fire-and-forget: dispatches to each subscriber in its own goroutine, recovers panics, logs failures, **never returns an error to the caller** (mirrors `KafkaClient.publish()`'s swallow-and-log semantics per spec §2).

- [ ] **Step 1: Write the failing test**

`backend-go/internal/platform/events/events_test.go`:
```go
package events_test

import (
	"bytes"
	"context"
	"sync"
	"testing"
	"time"

	"nexus-connect/backend-go/internal/platform/events"
	"nexus-connect/backend-go/internal/platform/logger"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type testEvent struct {
	msg string
}

func (t testEvent) EventType() string { return "test.event" }

func TestPublish_DeliversToSubscriber(t *testing.T) {
	bus := events.NewBus(logger.New("test"))

	received := make(chan string, 1)
	bus.Subscribe("test.event", func(ctx context.Context, e events.Event) {
		received <- e.(testEvent).msg
	})

	bus.Publish(context.Background(), testEvent{msg: "hello"})

	select {
	case msg := <-received:
		assert.Equal(t, "hello", msg)
	case <-time.After(time.Second):
		t.Fatal("subscriber was never called")
	}
}

func TestPublish_DeliversToMultipleSubscribers(t *testing.T) {
	bus := events.NewBus(logger.New("test"))
	var mu sync.Mutex
	var calls int

	for i := 0; i < 3; i++ {
		bus.Subscribe("test.event", func(ctx context.Context, e events.Event) {
			mu.Lock()
			calls++
			mu.Unlock()
		})
	}

	bus.Publish(context.Background(), testEvent{msg: "x"})
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	assert.Equal(t, 3, calls)
}

func TestPublish_NoSubscribersDoesNotBlock(t *testing.T) {
	bus := events.NewBus(logger.New("test"))
	done := make(chan struct{})
	go func() {
		bus.Publish(context.Background(), testEvent{msg: "nobody listening"})
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Publish blocked with no subscribers")
	}
}

func TestPublish_RecoversFromPanickingSubscriber(t *testing.T) {
	var buf bytes.Buffer
	log := logger.NewWithWriter("test", &buf)
	bus := events.NewBus(log)

	recovered := make(chan struct{})
	bus.Subscribe("test.event", func(ctx context.Context, e events.Event) {
		defer close(recovered)
		panic("boom")
	})

	require.NotPanics(t, func() {
		bus.Publish(context.Background(), testEvent{msg: "x"})
	})

	select {
	case <-recovered:
	case <-time.After(time.Second):
		t.Fatal("panicking subscriber was never invoked")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test ./internal/platform/events/... -v`
Expected: FAIL — package doesn't exist.

- [ ] **Step 3: Implement `events.go`**

`backend-go/internal/platform/events/events.go`:
```go
package events

import (
	"context"
	"log/slog"
	"sync"
)

type Event interface {
	EventType() string
}

type Handler func(ctx context.Context, e Event)

type Bus struct {
	mu          sync.RWMutex
	subscribers map[string][]Handler
	log         *slog.Logger
}

func NewBus(log *slog.Logger) *Bus {
	return &Bus{
		subscribers: make(map[string][]Handler),
		log:         log,
	}
}

func (b *Bus) Subscribe(eventType string, h Handler) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.subscribers[eventType] = append(b.subscribers[eventType], h)
}

// Publish dispatches e to every subscriber of its EventType() in its own
// goroutine. Mirrors KafkaClient.publish()'s fire-and-forget semantics:
// a subscriber failing (panic or otherwise) is logged, never returned to
// the caller, and never blocks or affects other subscribers.
func (b *Bus) Publish(ctx context.Context, e Event) {
	b.mu.RLock()
	handlers := append([]Handler(nil), b.subscribers[e.EventType()]...)
	b.mu.RUnlock()

	for _, h := range handlers {
		go func(h Handler) {
			defer func() {
				if r := recover(); r != nil {
					b.log.Error("event subscriber panicked",
						"eventType", e.EventType(), "panic", r)
				}
			}()
			h(ctx, e)
		}(h)
	}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend-go && go test -race ./internal/platform/events/... -v`
Expected: PASS, all 4 tests green, no race detected.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/platform/events
git commit -m "backend-go: add platform/events (in-process fire-and-forget pub/sub bus)"
```

---

## Task 10: `internal/platform/realtime` — Redis-backed cross-instance fan-out

**Files:**
- Create: `backend-go/internal/platform/realtime/realtime.go`
- Create: `backend-go/internal/platform/realtime/realtime_test.go` (build-tagged `integration`)

**Interfaces:**
- Consumes: `*cache.Cache` (Task 7, specifically `Publish`/`Subscribe`), `*slog.Logger` (Task 3).
- Produces:
  - `type Fanout struct`
  - `func NewFanout(c *cache.Cache, log *slog.Logger) *Fanout`
  - `func (f *Fanout) Publish(ctx context.Context, channel string, payload []byte) error`
  - `func (f *Fanout) Subscribe(ctx context.Context, channel string, handler func(payload []byte)) (unsubscribe func(), err error)` — **unlike the original's dead-code subscription, this actually runs a goroutine loop calling `handler` for every message received**, per spec §2/§4.5.
  - `func (f *Fanout) Close() error` — tears down all active subscriptions.

- [ ] **Step 1: Write the failing integration test — this is the test called out in spec §5 and the plan's Review Focus as proving the one genuinely new behavior**

`backend-go/internal/platform/realtime/realtime_test.go`:
```go
//go:build integration

package realtime_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"nexus-connect/backend-go/internal/platform/cache"
	"nexus-connect/backend-go/internal/platform/logger"
	"nexus-connect/backend-go/internal/platform/realtime"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
)

func startSharedRedis(t *testing.T) string {
	t.Helper()
	ctx := context.Background()
	container, err := tcredis.Run(ctx, "redis:7-alpine")
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })
	connStr, err := container.ConnectionString(ctx)
	require.NoError(t, err)
	return connStr
}

// TestCrossReplicaDelivery simulates the exact scenario documented as a known
// gap in the original TS code (ARCHITECTURE.md risk #1): a message published
// by "replica A" must be received by a subscriber running in "replica B",
// where A and B are two independent Fanout instances sharing only Redis —
// no shared Go memory, proving this isn't accidentally working via a
// process-local shortcut.
func TestCrossReplicaDelivery(t *testing.T) {
	addr := startSharedRedis(t)

	replicaA := realtime.NewFanout(cache.New(addr, "", 0), logger.New("replica-a"))
	defer replicaA.Close()
	replicaB := realtime.NewFanout(cache.New(addr, "", 0), logger.New("replica-b"))
	defer replicaB.Close()

	ctx := context.Background()
	received := make(chan string, 1)

	unsubscribe, err := replicaB.Subscribe(ctx, "chat:room-1", func(payload []byte) {
		received <- string(payload)
	})
	require.NoError(t, err)
	defer unsubscribe()

	time.Sleep(200 * time.Millisecond) // allow the subscription to register with Redis

	require.NoError(t, replicaA.Publish(ctx, "chat:room-1", []byte("hello from replica A")))

	select {
	case msg := <-received:
		assert.Equal(t, "hello from replica A", msg)
	case <-time.After(3 * time.Second):
		t.Fatal("replica B never received the message published by replica A")
	}
}

func TestConcurrentPublish_NoDataRace(t *testing.T) {
	addr := startSharedRedis(t)
	f := realtime.NewFanout(cache.New(addr, "", 0), logger.New("concurrent-test"))
	defer f.Close()
	ctx := context.Background()

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_ = f.Publish(ctx, "stress-channel", []byte("msg"))
		}(i)
	}
	wg.Wait()
}

func TestUnsubscribe_StopsDelivery(t *testing.T) {
	addr := startSharedRedis(t)
	publisher := realtime.NewFanout(cache.New(addr, "", 0), logger.New("pub"))
	defer publisher.Close()
	subscriber := realtime.NewFanout(cache.New(addr, "", 0), logger.New("sub"))
	defer subscriber.Close()
	ctx := context.Background()

	var mu sync.Mutex
	count := 0
	unsubscribe, err := subscriber.Subscribe(ctx, "unsub-test", func(payload []byte) {
		mu.Lock()
		count++
		mu.Unlock()
	})
	require.NoError(t, err)

	time.Sleep(200 * time.Millisecond)
	require.NoError(t, publisher.Publish(ctx, "unsub-test", []byte("one")))
	time.Sleep(200 * time.Millisecond)

	unsubscribe()
	time.Sleep(100 * time.Millisecond)

	require.NoError(t, publisher.Publish(ctx, "unsub-test", []byte("two")))
	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	assert.Equal(t, 1, count, "no message should be delivered after unsubscribe")
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test -tags=integration ./internal/platform/realtime/... -v`
Expected: FAIL — package doesn't exist.

- [ ] **Step 3: Implement `realtime.go`**

`backend-go/internal/platform/realtime/realtime.go`:
```go
package realtime

import (
	"context"
	"log/slog"
	"sync"

	"nexus-connect/backend-go/internal/platform/cache"
)

// Fanout is the piece the original TS codebase was missing: a Redis-pub/sub
// subscription that actually has a message handler wired up, so an event
// published by one process reaches subscribers running in a different
// process. See spec §2 ("WebSocket horizontal scaling") and
// ARCHITECTURE.md risk #1 in the harness docs for the gap this closes.
type Fanout struct {
	cache *cache.Cache
	log   *slog.Logger

	mu   sync.Mutex
	subs map[string]func() // channel -> cancel func, for Close()
}

func NewFanout(c *cache.Cache, log *slog.Logger) *Fanout {
	return &Fanout{
		cache: c,
		log:   log,
		subs:  make(map[string]func()),
	}
}

func (f *Fanout) Publish(ctx context.Context, channel string, payload []byte) error {
	return f.cache.Publish(ctx, channel, string(payload))
}

// Subscribe starts a goroutine that forwards every message received on
// channel to handler, until the returned unsubscribe func is called or ctx
// is cancelled. Unlike the original dead-code subscription, this handler is
// the whole point — it is what makes cross-replica delivery actually work.
func (f *Fanout) Subscribe(ctx context.Context, channel string, handler func(payload []byte)) (func(), error) {
	pubsub := f.cache.Subscribe(ctx, channel)

	subCtx, cancel := context.WithCancel(ctx)
	msgCh := pubsub.Channel()

	go func() {
		for {
			select {
			case <-subCtx.Done():
				return
			case msg, ok := <-msgCh:
				if !ok {
					return
				}
				func() {
					defer func() {
						if r := recover(); r != nil {
							f.log.Error("realtime subscriber handler panicked",
								"channel", channel, "panic", r)
						}
					}()
					handler([]byte(msg.Payload))
				}()
			}
		}
	}()

	unsubscribe := func() {
		cancel()
		_ = pubsub.Close()
		f.mu.Lock()
		delete(f.subs, channel)
		f.mu.Unlock()
	}

	f.mu.Lock()
	f.subs[channel] = unsubscribe
	f.mu.Unlock()

	return unsubscribe, nil
}

func (f *Fanout) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, unsubscribe := range f.subs {
		unsubscribe()
	}
	return nil
}
```

- [ ] **Step 4: Run the test to verify it passes, including the race detector**

Run: `cd backend-go && go test -race -tags=integration ./internal/platform/realtime/... -v`
Expected: PASS, all 3 tests green, no data race.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/platform/realtime
git commit -m "backend-go: add platform/realtime (real Redis pub/sub fan-out, fixes original's dead subscription)"
```

**Plan correction (found during implementation/review, not in the original text above):** Step 3's `Close()` deadlocks the first time it's called while a subscription is still active — it holds `f.mu.Lock()` for its whole loop, and the `unsubscribe` closure it calls re-acquires `f.mu` to delete its own map entry, which is a self-deadlock on Go's non-reentrant `sync.Mutex`. None of the 3 tests above catch this: in every one, `unsubscribe()` already ran (via defer order or an explicit call) before `Close()` did, so `f.subs` was always empty by the time `Close()` iterated it. This matters because Task 15's fx `OnStop` shutdown hook is exactly the call site that calls `Close()` with subscriptions still active.

Two more defects surfaced by review once this was being looked at closely:
- `f.subs` keyed by channel name meant two independent `Subscribe` calls on the same channel clobbered each other's bookkeeping — unsubscribing one could silently drop the other's entry, leaking its goroutine + Redis connection past `Close()`.
- A `Subscribe` call racing `Close()` could end up neither torn down by `Close()` (if it registered after `Close()`'s snapshot) nor self-cleaning.

Fix actually implemented: `f.subs` is keyed by a monotonic per-call `uint64` ID instead of channel name; `Close()` copies the handler closures out of the map under lock, releases the lock, then calls each outside the lock; `Subscribe` checks a new `closed bool` (guarded by `f.mu`) once at entry and again right before registering, self-unsubscribing and returning the new `ErrClosed` if `Close()` won the race; and the forwarding goroutine now calls `unsubscribe()` itself on `subCtx.Done()` instead of returning bare, so cancelling the caller's `ctx` alone no longer leaks the Redis pubsub connection. Added tests: `TestClose_TearsDownActiveSubscriptionWithoutDeadlock`, `TestSubscribe_AfterCloseReturnsError`, `TestSubscribe_SameChannelTwiceIndependentUnsubscribe`. One interleaving remains untested — the second `closed` check's race window is microseconds wide with no I/O in between, so forcing it open deterministically would require a test-only synchronization hook in production code; verified correct by two independent reviews reasoning through the mutex semantics directly instead.

---

## Task 11: `internal/platform/auth` — JWT, bcrypt, auth middleware

**Files:**
- Create: `backend-go/internal/platform/auth/auth.go`
- Create: `backend-go/internal/platform/auth/middleware.go`
- Create: `backend-go/internal/platform/auth/auth_test.go`
- Create: `backend-go/internal/platform/auth/middleware_test.go`

**Interfaces:**
- Consumes: `apperrors.TokenExpired()`, `apperrors.InvalidToken()`, `apperrors.Unauthorized()` (Task 2).
- Produces:
  - `type TokenPayload struct { UserID string; Email string }` with JSON tags matching the original (`userId`, `email`).
  - `func HashPassword(password string) (string, error)` — bcrypt cost 12.
  - `func ComparePassword(password, hash string) bool`
  - `func GenerateAccessToken(payload TokenPayload, secret string, ttl time.Duration) (string, error)`
  - `func GenerateRefreshToken(payload TokenPayload, secret string, ttl time.Duration) (string, error)`
  - `func VerifyToken(tokenString, secret string) (TokenPayload, error)` — returns `*apperrors.AppError` wrapping `TokenExpired()` or `InvalidToken()` on failure, matching the original's distinction exactly.
  - `type contextKey string; const UserContextKey contextKey = "user"`
  - `func Middleware(secret string) func(http.Handler) http.Handler` — chi-compatible middleware extracting `Authorization: Bearer <token>`, verifying it, and attaching `TokenPayload` to the request context; returns 401 with the mapped `AppError` JSON on failure (via Task 13's error-writing helper — see note in Step 4).
  - `func FromContext(ctx context.Context) (TokenPayload, bool)`

- [ ] **Step 1: Write the failing test for token generation/verification**

`backend-go/internal/platform/auth/auth_test.go`:
```go
package auth_test

import (
	"testing"
	"time"

	"nexus-connect/backend-go/internal/platform/auth"
	apperrors "nexus-connect/backend-go/internal/platform/errors"
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
	payload := auth.TokenPayload{UserID: "u-1", Email: "a@example.com"}
	token, err := auth.GenerateAccessToken(payload, "test-secret-32-characters-min!!", time.Minute)
	require.NoError(t, err)

	got, err := auth.VerifyToken(token, "test-secret-32-characters-min!!")
	require.NoError(t, err)
	assert.Equal(t, payload, got)
}

func TestVerifyToken_ExpiredReturnsTokenExpiredError(t *testing.T) {
	payload := auth.TokenPayload{UserID: "u-1", Email: "a@example.com"}
	token, err := auth.GenerateAccessToken(payload, "test-secret-32-characters-min!!", -time.Minute) // already expired
	require.NoError(t, err)

	_, err = auth.VerifyToken(token, "test-secret-32-characters-min!!")
	require.Error(t, err)
	appErr, ok := apperrors.As(err)
	require.True(t, ok)
	assert.Equal(t, "TOKEN_EXPIRED", appErr.Code)
}

func TestVerifyToken_WrongSecretReturnsInvalidTokenError(t *testing.T) {
	payload := auth.TokenPayload{UserID: "u-1", Email: "a@example.com"}
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test ./internal/platform/auth/... -v`
Expected: FAIL — package doesn't exist.

- [ ] **Step 3: Implement `auth.go`**

`backend-go/internal/platform/auth/auth.go`:
```go
package auth

import (
	"errors"
	"time"

	apperrors "nexus-connect/backend-go/internal/platform/errors"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const bcryptCost = 12

type TokenPayload struct {
	UserID string `json:"userId"`
	Email  string `json:"email"`
}

type claims struct {
	TokenPayload
	jwt.RegisteredClaims
}

func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	return string(hash), err
}

func ComparePassword(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

func GenerateAccessToken(payload TokenPayload, secret string, ttl time.Duration) (string, error) {
	return generateToken(payload, secret, ttl)
}

func GenerateRefreshToken(payload TokenPayload, secret string, ttl time.Duration) (string, error) {
	return generateToken(payload, secret, ttl)
}

func generateToken(payload TokenPayload, secret string, ttl time.Duration) (string, error) {
	c := claims{
		TokenPayload: payload,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, c)
	return token.SignedString([]byte(secret))
}

// VerifyToken mirrors verifyAccessToken/verifyRefreshToken in crypto.ts,
// preserving the TokenExpired vs InvalidToken distinction the original
// middleware relies on.
func VerifyToken(tokenString, secret string) (TokenPayload, error) {
	var c claims
	token, err := jwt.ParseWithClaims(tokenString, &c, func(t *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	})

	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return TokenPayload{}, apperrors.TokenExpired()
		}
		return TokenPayload{}, apperrors.InvalidToken()
	}
	if !token.Valid {
		return TokenPayload{}, apperrors.InvalidToken()
	}

	return c.TokenPayload, nil
}
```

Note: use the stdlib `"errors"` package's `errors.Is` directly (add it to the import block alongside the aliased `apperrors "nexus-connect/backend-go/internal/platform/errors"` — the two don't collide, one is the bare stdlib name and the other is explicitly aliased). Do not hand-roll an unwrap loop; `jwt.ErrTokenExpired` is a sentinel error `jwt.ParseWithClaims` wraps, and `errors.Is` is the correct, idiomatic way to check for it.

- [ ] **Step 4: Run the token tests to verify they pass**

Run: `cd backend-go && go test ./internal/platform/auth/... -v -run 'TestHashAndCompare|TestGenerateAndVerify|TestVerifyToken'`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Write the failing test for the HTTP middleware**

`backend-go/internal/platform/auth/middleware_test.go`:
```go
package auth_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"nexus-connect/backend-go/internal/platform/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testSecret = "middleware-test-secret-32-chars!"

func protectedHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		payload, ok := auth.FromContext(r.Context())
		if !ok {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(payload.UserID))
	})
}

func TestMiddleware_ValidToken_AttachesPayloadAndCallsNext(t *testing.T) {
	token, err := auth.GenerateAccessToken(auth.TokenPayload{UserID: "u-42"}, testSecret, time.Minute)
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	auth.Middleware(testSecret)(protectedHandler()).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "u-42", rec.Body.String())
}

func TestMiddleware_MissingHeader_Returns401(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	rec := httptest.NewRecorder()

	auth.Middleware(testSecret)(protectedHandler()).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	var body map[string]map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "UNAUTHORIZED", body["error"]["code"])
}

func TestMiddleware_MalformedHeader_Returns401(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "NotBearer sometoken")
	rec := httptest.NewRecorder()

	auth.Middleware(testSecret)(protectedHandler()).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestMiddleware_ExpiredToken_ReturnsTokenExpiredCode(t *testing.T) {
	token, err := auth.GenerateAccessToken(auth.TokenPayload{UserID: "u-1"}, testSecret, -time.Minute)
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	auth.Middleware(testSecret)(protectedHandler()).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	var body map[string]map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "TOKEN_EXPIRED", body["error"]["code"])
}
```

- [ ] **Step 6: Run the middleware test to verify it fails**

Run: `cd backend-go && go test ./internal/platform/auth/... -v -run TestMiddleware`
Expected: FAIL — `auth.Middleware`/`auth.FromContext` don't exist.

- [ ] **Step 7: Implement `middleware.go`**

`backend-go/internal/platform/auth/middleware.go`:
```go
package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	apperrors "nexus-connect/backend-go/internal/platform/errors"
)

type contextKey string

const UserContextKey contextKey = "user"

// Middleware extracts and verifies the Bearer token, attaching TokenPayload
// to the request context on success. On failure it writes the AppError JSON
// envelope directly (the same shape Task 13's global error middleware
// produces) rather than deferring to it, since auth failure must short-
// circuit before any handler-level error-returning convention applies.
func Middleware(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if header == "" {
				writeAuthError(w, apperrors.Unauthorized("Missing authorization header"))
				return
			}

			parts := strings.SplitN(header, " ", 2)
			if len(parts) != 2 || parts[0] != "Bearer" {
				writeAuthError(w, apperrors.Unauthorized("Invalid authorization header format"))
				return
			}

			payload, err := VerifyToken(parts[1], secret)
			if err != nil {
				appErr, ok := apperrors.As(err)
				if !ok {
					appErr = apperrors.InvalidToken()
				}
				writeAuthError(w, appErr)
				return
			}

			ctx := context.WithValue(r.Context(), UserContextKey, payload)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func FromContext(ctx context.Context) (TokenPayload, bool) {
	payload, ok := ctx.Value(UserContextKey).(TokenPayload)
	return payload, ok
}

func writeAuthError(w http.ResponseWriter, err *apperrors.AppError) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(err.StatusCode)
	_ = json.NewEncoder(w).Encode(err)
}
```

- [ ] **Step 8: Run all auth package tests to verify they pass**

Run: `cd backend-go && go test ./internal/platform/auth/... -v`
Expected: PASS, all 9 tests green.

- [ ] **Step 9: Commit**

```bash
git add backend-go/internal/platform/auth backend-go/go.mod backend-go/go.sum
git commit -m "backend-go: add platform/auth (JWT, bcrypt, chi middleware with TokenExpired/InvalidToken distinction)"
```

**Plan correction (found during implementation/review, not in the original text above):** `TokenPayload`'s interface spec above only had `UserID`/`Email`, but the actual original (`backend/packages/shared/src/types/user.ts`'s `TokenPayload` interface, populated in `auth-service/src/services/auth.service.ts:148`) has a third field, `uniqueNumber: string`. Dropping it would silently lose data on any token this package round-trips once wired into the real auth domain module. Added `UniqueNumber string \`json:"uniqueNumber"\`` to the struct; `TestGenerateAndVerifyAccessToken_RoundTrips` et al. updated to set it.

Also, `VerifyToken`'s keyfunc now checks `t.Method.(*jwt.SigningMethodHMAC)` before returning the secret, rejecting any token whose header claims a non-HMAC algorithm — not because this single-algorithm (HS256-only) deployment is actually exploitable without it (golang-jwt's `SigningMethodRSA`/`SigningMethodECDSA` already reject a `[]byte` key via their own type assertions, and `alg: none` requires the keyfunc to explicitly opt in via `jwt.UnsafeAllowNoneSignatureType`, which it never does), but because the library's own README carries this as a SECURITY NOTICE ("validate the alg presented is what you expect") and the check is free. Added `TestVerifyToken_RejectsNoneAlgorithm` as a regression test for the library's existing protection, documented in its comment as not proof of a bug this task fixes.

---

## Task 12: `internal/platform/validate` — struct validation

**Files:**
- Create: `backend-go/internal/platform/validate/validate.go`
- Create: `backend-go/internal/platform/validate/validate_test.go`

**Interfaces:**
- Consumes: `apperrors.Validation(message, details)` (Task 2).
- Produces:
  - `func Struct(v any) error` — runs `go-playground/validator`, returns `nil` on success or `*apperrors.AppError` (code `VALIDATION_ERROR`, `Details` keyed by field name, mirroring `validate()` in `validators.ts`) on failure.
  - A registered custom validator tag `password_strength` matching `PasswordStrengthSchema`'s rules (8-128 chars, upper+lower+digit+special).

- [ ] **Step 1: Write the failing test**

`backend-go/internal/platform/validate/validate_test.go`:
```go
package validate_test

import (
	"testing"

	"nexus-connect/backend-go/internal/platform/validate"
	apperrors "nexus-connect/backend-go/internal/platform/errors"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type registerInput struct {
	Email       string `validate:"required,email"`
	Password    string `validate:"required,password_strength"`
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test ./internal/platform/validate/... -v`
Expected: FAIL — package doesn't exist.

- [ ] **Step 3: Implement `validate.go`**

`backend-go/internal/platform/validate/validate.go`:
```go
package validate

import (
	"fmt"
	"regexp"
	"sync"

	apperrors "nexus-connect/backend-go/internal/platform/errors"
	"github.com/go-playground/validator/v10"
)

var (
	once     sync.Once
	instance *validator.Validate

	hasUpper   = regexp.MustCompile(`[A-Z]`)
	hasLower   = regexp.MustCompile(`[a-z]`)
	hasDigit   = regexp.MustCompile(`[0-9]`)
	hasSpecial = regexp.MustCompile(`[!@#$%^&*(),.?":{}|<>]`)
)

func get() *validator.Validate {
	once.Do(func() {
		instance = validator.New()
		_ = instance.RegisterValidation("password_strength", passwordStrength)
	})
	return instance
}

// passwordStrength mirrors PasswordStrengthSchema in validators.ts:
// 8-128 chars, at least one upper, lower, digit, and special character.
// min/max length are expressed as separate "min=8,max=128" tags alongside
// this one in struct definitions, not duplicated here.
func passwordStrength(fl validator.FieldLevel) bool {
	v := fl.Field().String()
	return hasUpper.MatchString(v) && hasLower.MatchString(v) &&
		hasDigit.MatchString(v) && hasSpecial.MatchString(v)
}

// Struct validates v and, on failure, returns an *apperrors.AppError with
// Code "VALIDATION_ERROR" and Details keyed by field name — mirroring
// validate()/safeValidate() in validators.ts.
func Struct(v any) error {
	err := get().Struct(v)
	if err == nil {
		return nil
	}

	validationErrs, ok := err.(validator.ValidationErrors)
	if !ok {
		return apperrors.Validation("Validation failed", nil)
	}

	details := make(map[string]any, len(validationErrs))
	for _, fe := range validationErrs {
		details[fe.Field()] = fmt.Sprintf("failed on the '%s' rule", fe.Tag())
	}

	return apperrors.Validation("Validation failed", details)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend-go && go test ./internal/platform/validate/... -v`
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/platform/validate backend-go/go.mod backend-go/go.sum
git commit -m "backend-go: add platform/validate (go-playground/validator + password_strength rule)"
```

**Plan correction (found during implementation, not in the original text above):** Step 1's `registerInput` test struct had `Password string \`validate:"required,password_strength"\`` — no length tag. Since `passwordStrength` only checks character-class composition (never length), `TestStruct_PasswordStrength_RejectsTooShort`'s 6-char `"Sh0rt!"` (which has upper/lower/digit/special all present) would have passed validation, not failed as the test expects — the plan's own test contradicted its own code comment, which already said length should be a separate `min=8,max=128` tag alongside `password_strength` (matching `validators.ts:79-89`'s `.min(8).max(128)` chained before its character-class `.refine()` calls). Fixed by adding `min=8,max=128` to the test struct's Password tag.

---

## Task 13: `internal/platform/httpserver` — router, middleware, error mapping

**Files:**
- Create: `backend-go/internal/platform/httpserver/server.go`
- Create: `backend-go/internal/platform/httpserver/errorhandler.go`
- Create: `backend-go/internal/platform/httpserver/server_test.go`

**Interfaces:**
- Consumes: `apperrors.As` (Task 2), `*slog.Logger` (Task 3), `[]string` CORS origins (Task 5's `Config.CORSOrigins`).
- Produces:
  - `type HandlerFunc func(w http.ResponseWriter, r *http.Request) error` — the convention every future domain module's `handler.go` uses.
  - `func Wrap(log *slog.Logger, fn HandlerFunc) http.HandlerFunc` — calls `fn`; if it returns a non-nil error, maps it (via `apperrors.As`, defaulting to `apperrors.Internal`) to the JSON envelope and correct status code, and logs 5xx errors.
  - `func NewRouter(log *slog.Logger, corsOrigins []string) *chi.Mux` — registers `middleware.Recoverer` (chi's own, renamed in use to avoid confusion with `apperrors`), request-ID middleware, CORS, and security headers (`X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection`, `Referrer-Policy`), plus `GET /health` returning `200 {"status":"ok"}`.
  - `func WriteJSON(w http.ResponseWriter, status int, v any) error` — small helper every domain handler uses for success responses, kept here so there's one place both success and error responses are written from.

- [ ] **Step 1: Write the failing test**

`backend-go/internal/platform/httpserver/server_test.go`:
```go
package httpserver_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	apperrors "nexus-connect/backend-go/internal/platform/errors"
	"nexus-connect/backend-go/internal/platform/httpserver"
	"nexus-connect/backend-go/internal/platform/logger"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHealthEndpoint_Returns200(t *testing.T) {
	router := httpserver.NewRouter(logger.New("test"), []string{"*"})
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	var body map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "ok", body["status"])
}

func TestWrap_SuccessPassesThrough(t *testing.T) {
	log := logger.New("test")
	handler := httpserver.Wrap(log, func(w http.ResponseWriter, r *http.Request) error {
		return httpserver.WriteJSON(w, http.StatusCreated, map[string]string{"id": "123"})
	})

	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rec := httptest.NewRecorder()
	handler(rec, req)

	assert.Equal(t, http.StatusCreated, rec.Code)
}

func TestWrap_AppErrorMapsToCorrectStatusAndBody(t *testing.T) {
	log := logger.New("test")
	handler := httpserver.Wrap(log, func(w http.ResponseWriter, r *http.Request) error {
		return apperrors.NotFound("Chat")
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	handler(rec, req)

	assert.Equal(t, http.StatusNotFound, rec.Code)
	var body map[string]map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "NOT_FOUND", body["error"]["code"])
	assert.Equal(t, "Chat not found", body["error"]["message"])
}

func TestWrap_PlainErrorMapsTo500(t *testing.T) {
	log := logger.New("test")
	handler := httpserver.Wrap(log, func(w http.ResponseWriter, r *http.Request) error {
		return assertAnError()
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	handler(rec, req)

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	var body map[string]map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "INTERNAL_ERROR", body["error"]["code"])
}

func TestRouter_SetsSecurityHeaders(t *testing.T) {
	router := httpserver.NewRouter(logger.New("test"), []string{"*"})
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	assert.Equal(t, "nosniff", rec.Header().Get("X-Content-Type-Options"))
	assert.Equal(t, "SAMEORIGIN", rec.Header().Get("X-Frame-Options"))
}

func TestRouter_RecoversFromPanicInHandler(t *testing.T) {
	router := httpserver.NewRouter(logger.New("test"), []string{"*"})
	router.Get("/panics", func(w http.ResponseWriter, r *http.Request) {
		panic("boom")
	})

	req := httptest.NewRequest(http.MethodGet, "/panics", nil)
	rec := httptest.NewRecorder()

	assert.NotPanics(t, func() {
		router.ServeHTTP(rec, req)
	})
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
}

func assertAnError() error {
	return &plainErr{}
}

type plainErr struct{}

func (p *plainErr) Error() string { return "boom" }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test ./internal/platform/httpserver/... -v`
Expected: FAIL — package doesn't exist.

- [ ] **Step 3: Implement `errorhandler.go`**

`backend-go/internal/platform/httpserver/errorhandler.go`:
```go
package httpserver

import (
	"encoding/json"
	"log/slog"
	"net/http"

	apperrors "nexus-connect/backend-go/internal/platform/errors"
)

type HandlerFunc func(w http.ResponseWriter, r *http.Request) error

// Wrap adapts a HandlerFunc (which can return an error) into a standard
// http.HandlerFunc, mapping any returned error to the same
// {"error":{"code","message","details"}} JSON shape the original
// TypeScript services' global error handlers produce.
func Wrap(log *slog.Logger, fn HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		err := fn(w, r)
		if err == nil {
			return
		}

		appErr, ok := apperrors.As(err)
		if !ok {
			appErr = apperrors.Internal(err.Error())
		}

		if appErr.StatusCode >= 500 {
			log.Error("request failed", "error", err, "path", r.URL.Path, "method", r.Method)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(appErr.StatusCode)
		_ = json.NewEncoder(w).Encode(appErr)
	}
}

func WriteJSON(w http.ResponseWriter, status int, v any) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(v)
}
```

- [ ] **Step 4: Implement `server.go`**

`backend-go/internal/platform/httpserver/server.go`:
```go
package httpserver

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
)

func NewRouter(log *slog.Logger, corsOrigins []string) *chi.Mux {
	r := chi.NewRouter()

	r.Use(chimw.RequestID)
	r.Use(recoverer(log))
	r.Use(securityHeaders)
	r.Use(cors(corsOrigins))

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		_ = WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	return r
}

// recoverer mirrors chi's built-in Recoverer but maps the panic to our
// AppError JSON envelope instead of chi's default plain-text 500 body.
func recoverer(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					log.Error("panic recovered", "panic", rec, "path", r.URL.Path)
					Wrap(log, func(w http.ResponseWriter, r *http.Request) error {
						return nil // body already needs writing below; see note
					})
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusInternalServerError)
					_, _ = w.Write([]byte(`{"error":{"code":"INTERNAL_ERROR","message":"Internal server error","details":null}}`))
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-XSS-Protection", "1; mode=block")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}

func cors(allowedOrigins []string) func(http.Handler) http.Handler {
	allowed := make(map[string]bool, len(allowedOrigins))
	allowAll := false
	for _, o := range allowedOrigins {
		if o == "*" {
			allowAll = true
		}
		allowed[o] = true
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if allowAll {
				w.Header().Set("Access-Control-Allow-Origin", "*")
			} else if allowed[origin] {
				w.Header().Set("Access-Control-Allow-Origin", origin)
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
```

- [ ] **Step 5: Remove the dead no-op call left in `recoverer` during drafting**

The `Wrap(log, func(...) error { return nil })` call inside `recoverer` does nothing useful and was a leftover from an earlier draft — delete those three lines so `recoverer` just logs and writes the body directly:

```go
func recoverer(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					log.Error("panic recovered", "panic", rec, "path", r.URL.Path)
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusInternalServerError)
					_, _ = w.Write([]byte(`{"error":{"code":"INTERNAL_ERROR","message":"Internal server error","details":null}}`))
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend-go && go test ./internal/platform/httpserver/... -v`
Expected: PASS, all 6 tests green.

- [ ] **Step 7: Commit**

```bash
git add backend-go/internal/platform/httpserver backend-go/go.mod backend-go/go.sum
git commit -m "backend-go: add platform/httpserver (chi router, error-mapping middleware, security headers)"
```

**Plan correction (found during implementation/review, not in the original text above):** four issues fixed before this was ever run against the plan's literal code:

1. Step 4's `recoverer` hardcoded the panic-recovery body as a literal `{"error":{...,"details":null}}` string — contradicting Task 2's own `omitempty` contract (the key must be absent, never literal null). Replaced with a shared `writeAppError` helper (now used by both `Wrap` and `recoverer`) that marshals through the real `AppError.MarshalJSON()`.
2. Step 4 registered middleware as `RequestID, recoverer, securityHeaders, cors` — `recoverer` wasn't outermost, so a panic inside `RequestID` itself would propagate uncaught. Reordered to `recoverer, RequestID, securityHeaders, cors` (confirmed via chi v5.1.0's `chain.go`: the first `Use()` call becomes the outermost wrapper).
3. Neither `Wrap` nor the original `recoverer` guarded against double-writing a response: if a handler's returned error or panic happened *after* it already started writing its own response (e.g., `WriteJSON`'s header succeeded but body-encode then failed), the old code unconditionally tried to write a second, different status+body on top. Added a shared `statusTrackingWriter` (records whether `WriteHeader`/`Write` already ran) that both `Wrap` and `recoverer` check first. Known residual gap, not fixed (nothing in this plan exercises it): embedding `http.ResponseWriter` promotes `Flusher`/`Hijacker` untouched, so a streaming/SSE/websocket handler calling `Flush()`/`Hijack()` without a prior `Write` would leave `started` false — revisit before building one; this reimplementation also lacks chi's own `Recoverer`'s `Connection: Upgrade` guard.
4. The non-`AppError` fallback path sent the raw error's `.Error()` text directly to the client as the response `message` (`apperrors.Internal(err.Error())`) — a real information-disclosure regression from the actual original (`backend/services/auth-service/src/server.ts`'s error handler logs the full error server-side but always sends a generic client-facing message, never `error.message`). Changed to `apperrors.Internal("")`, which falls back to AppError's own safe default; the real error is still logged server-side via the existing `log.Error(...)` call using the un-redacted `err`.

Added tests: `TestRecoverer_PanicResponseOmitsDetailsKey`, `TestRecoverer_PanicAfterResponseAlreadyStartedDoesNotCorruptIt`, `TestWrap_ErrorAfterResponseAlreadyStartedDoesNotCorruptIt`, `TestWrap_PlainErrorDoesNotLeakRawErrorTextToClient`.

---

## Task 14: `internal/platform/migrations` — golang-migrate wiring

**Files:**
- Create: `backend-go/internal/platform/migrations/migrations.go`
- Create: `backend-go/internal/platform/migrations/sql/0001_initial_schema.up.sql`
- Create: `backend-go/internal/platform/migrations/sql/0001_initial_schema.down.sql`
- Create: `backend-go/internal/platform/migrations/migrations_test.go` (build-tagged `integration`)

**Interfaces:**
- Consumes: a Postgres DSN (Task 5's `Config.PostgresDSN()`).
- Produces: `func Run(dsn string) error` — applies all pending migrations, treating "no change" as success (not an error), matching golang-migrate's own `ErrNoChange` convention.

- [ ] **Step 1: Translate `backend/infrastructure/postgres/init.sql` into a versioned migration — write the `up` file verbatim (table-for-table, per spec §4.7/§5)**

`backend-go/internal/platform/migrations/sql/0001_initial_schema.up.sql`:
```sql
-- Mirrors backend/infrastructure/postgres/init.sql table-for-table.
-- The `migrations` bookkeeping table itself is no longer needed —
-- golang-migrate tracks applied versions in its own schema_migrations table.

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    unique_number VARCHAR(10) NOT NULL UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    profile_picture_url TEXT,
    status VARCHAR(20) DEFAULT 'offline',
    email_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_unique_number ON users(unique_number);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE TABLE IF NOT EXISTS chats (
    id UUID PRIMARY KEY,
    type VARCHAR(10) NOT NULL CHECK (type IN ('direct', 'group')),
    name VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chats_type ON chats(type);

CREATE TABLE IF NOT EXISTS chat_participants (
    chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_read_at TIMESTAMP WITH TIME ZONE,
    is_admin BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_participants_user ON chat_participants(user_id);

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY,
    chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL,
    type VARCHAR(10) NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image', 'file', 'audio', 'video', 'system')),
    content TEXT NOT NULL,
    metadata JSONB,
    status VARCHAR(10) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
    reply_to_id UUID REFERENCES messages(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(chat_id, created_at DESC);

CREATE TABLE IF NOT EXISTS calls (
    id UUID PRIMARY KEY,
    room_id VARCHAR(100) NOT NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('audio', 'video')),
    status VARCHAR(20) NOT NULL DEFAULT 'initiating',
    initiator_id UUID NOT NULL,
    is_group_call BOOLEAN DEFAULT FALSE,
    group_id UUID,
    started_at TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calls_initiator ON calls(initiator_id);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);

CREATE TABLE IF NOT EXISTS call_participants (
    id UUID PRIMARY KEY,
    call_id UUID REFERENCES calls(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'invited',
    is_muted BOOLEAN DEFAULT FALSE,
    is_video_enabled BOOLEAN DEFAULT TRUE,
    is_screen_sharing BOOLEAN DEFAULT FALSE,
    joined_at TIMESTAMP WITH TIME ZONE,
    left_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_call_participants_call ON call_participants(call_id);
CREATE INDEX IF NOT EXISTS idx_call_participants_user ON call_participants(user_id);

CREATE TABLE IF NOT EXISTS call_history (
    id UUID PRIMARY KEY,
    call_id UUID NOT NULL,
    user_id UUID NOT NULL,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
    type VARCHAR(10) NOT NULL CHECK (type IN ('audio', 'video')),
    status VARCHAR(10) NOT NULL CHECK (status IN ('answered', 'missed', 'declined', 'ongoing', 'ringing')),
    duration INTEGER,
    participant_count INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_history_user ON call_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_history_call ON call_history(call_id);

CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500),
    avatar_url TEXT,
    created_by_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_groups_created_by ON groups(created_by_id);

CREATE TABLE IF NOT EXISTS group_members (
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    role VARCHAR(10) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    invited_by_id UUID,
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);

CREATE TABLE IF NOT EXISTS expenses (
    id UUID PRIMARY KEY,
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    created_by_id UUID NOT NULL,
    description VARCHAR(200) NOT NULL,
    total_amount DECIMAL(15, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    split_type VARCHAR(20) NOT NULL CHECK (split_type IN ('equal', 'exact', 'percentage')),
    paid_by_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    settled_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_expenses_group ON expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_expenses_created_by ON expenses(created_by_id);

CREATE TABLE IF NOT EXISTS expense_splits (
    id UUID PRIMARY KEY,
    expense_id UUID REFERENCES expenses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    percentage DECIMAL(5, 2),
    is_paid BOOLEAN DEFAULT FALSE,
    paid_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_expense_splits_expense ON expense_splits(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_splits_user ON expense_splits(user_id);

CREATE TABLE IF NOT EXISTS ledger_entries (
    id UUID PRIMARY KEY,
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    expense_id UUID,
    from_user_id UUID NOT NULL,
    to_user_id UUID NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    type VARCHAR(20) NOT NULL CHECK (type IN ('expense', 'settlement', 'adjustment')),
    description VARCHAR(200),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_group ON ledger_entries(group_id);
CREATE INDEX IF NOT EXISTS idx_ledger_from_user ON ledger_entries(from_user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_to_user ON ledger_entries(to_user_id);
```

- [ ] **Step 2: Write the `down` migration**

`backend-go/internal/platform/migrations/sql/0001_initial_schema.down.sql`:
```sql
DROP TABLE IF EXISTS ledger_entries;
DROP TABLE IF EXISTS expense_splits;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS group_members;
DROP TABLE IF EXISTS groups;
DROP TABLE IF EXISTS call_history;
DROP TABLE IF EXISTS call_participants;
DROP TABLE IF EXISTS calls;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS chat_participants;
DROP TABLE IF EXISTS chats;
DROP TABLE IF EXISTS users;
```

- [ ] **Step 3: Write the failing integration test**

`backend-go/internal/platform/migrations/migrations_test.go`:
```go
//go:build integration

package migrations_test

import (
	"context"
	"testing"

	"nexus-connect/backend-go/internal/platform/migrations"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

func startPostgres(t *testing.T) string {
	t.Helper()
	ctx := context.Background()
	container, err := postgres.Run(ctx, "postgres:16-alpine",
		postgres.WithDatabase("nexus_migrate_test"),
		postgres.WithUsername("postgres"),
		postgres.WithPassword("postgres"),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })
	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err)
	return dsn
}

func TestRun_CreatesAllTables(t *testing.T) {
	dsn := startPostgres(t)
	require.NoError(t, migrations.Run(dsn))

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	defer pool.Close()

	expectedTables := []string{
		"users", "chats", "chat_participants", "messages", "calls",
		"call_participants", "call_history", "groups", "group_members",
		"expenses", "expense_splits", "ledger_entries",
	}

	for _, table := range expectedTables {
		var exists bool
		err := pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
			table,
		).Scan(&exists)
		require.NoError(t, err)
		assert.True(t, exists, "expected table %q to exist after migration", table)
	}
}

func TestRun_IsIdempotent(t *testing.T) {
	dsn := startPostgres(t)
	require.NoError(t, migrations.Run(dsn))
	require.NoError(t, migrations.Run(dsn), "running migrations twice must not error")
}
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd backend-go && go test -tags=integration ./internal/platform/migrations/... -v`
Expected: FAIL — package `migrations` doesn't exist.

- [ ] **Step 5: Implement `migrations.go`**

`backend-go/internal/platform/migrations/migrations.go`:
```go
package migrations

import (
	"embed"
	"errors"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres" // registers the "postgres" driver via its init()
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

//go:embed sql/*.sql
var sqlFiles embed.FS

// Run applies every pending migration in sql/ against dsn. Running it
// against an already-up-to-date database is a no-op, not an error —
// Review Focus item: "golang-migrate run twice must not fail."
func Run(dsn string) error {
	source, err := iofs.New(sqlFiles, "sql")
	if err != nil {
		return fmt.Errorf("migrations: loading embedded SQL: %w", err)
	}

	m, err := migrate.NewWithSourceInstance("iofs", source, dsn)
	if err != nil {
		return fmt.Errorf("migrations: creating migrate instance: %w", err)
	}

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migrations: applying: %w", err)
	}

	srcErr, dbErr := m.Close()
	if srcErr != nil {
		return fmt.Errorf("migrations: closing source: %w", srcErr)
	}
	if dbErr != nil {
		return fmt.Errorf("migrations: closing db: %w", dbErr)
	}
	return nil
}
```

Note: the `database/postgres` import is blank (`_`) because nothing in this file references any of its exported identifiers directly — its registration of the `"postgres"` driver with `golang-migrate`'s internal registry happens entirely via that package's own `init()`, which a blank import still triggers. Do not invent a dummy reference like `postgres.Driver{}` to "use" the import instead — that package doesn't export a type called `Driver` (the `Driver` interface lives in `golang-migrate/migrate/v4/database`, not in the `postgres` subpackage), so it wouldn't compile, and it isn't necessary anyway.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend-go && go test -tags=integration ./internal/platform/migrations/... -v`
Expected: PASS, both tests green.

- [ ] **Step 7: Commit**

```bash
git add backend-go/internal/platform/migrations backend-go/go.mod backend-go/go.sum
git commit -m "backend-go: add platform/migrations (golang-migrate, schema ported table-for-table from init.sql)"
```

**Plan correction (found during implementation, not in the original text above):** Step 3's `startPostgres` test helper was missing `postgres.BasicWaitStrategies()` in its `postgres.Run(...)` call — the same defect as Task 6's `db_test.go`, and for the same reason: without it, testcontainers considers the container ready after Postgres' first startup, before its self-restart, producing "connection reset by peer" on the first real connection attempt. Added `postgres.BasicWaitStrategies()` to the options list.

---

## Task 15: `cmd/server/main.go` — fx wiring, lifecycle, `/health`

**Files:**
- Modify: `backend-go/cmd/server/main.go`
- Create: `backend-go/internal/platform/module.go`
- Create: `backend-go/cmd/server/main_test.go` (build-tagged `integration`)

**Interfaces:**
- Consumes: every `platform/*` package's constructors (Tasks 2–14).
- Produces: `var platform.Module = fx.Module("platform", ...)` bundling every platform provider; a running binary.

- [ ] **Step 1: Write the failing integration test (boot the app, hit `/health`, shut down cleanly)**

`backend-go/cmd/server/main_test.go`:
```go
//go:build integration

package main_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"nexus-connect/backend-go/internal/platform"
	"nexus-connect/backend-go/internal/platform/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/fx"
	"go.uber.org/fx/fxtest"
)

func TestApp_BootsServesHealthAndShutsDownCleanly(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "integration-test-access-secret-32!")
	t.Setenv("JWT_REFRESH_SECRET", "integration-test-refresh-secret-32")
	t.Setenv("PORT", "18080")
	// Postgres/Redis env vars are left at their config.Load() defaults
	// (localhost:5432 / localhost:6379) — this test assumes a docker-compose
	// environment with those running is NOT required for /health itself,
	// since /health must respond even before any DB/Redis dependency is
	// confirmed reachable (see Step 4's health-check design note).

	app := fxtest.New(t, platform.Module, fx.NopLogger)
	app.RequireStart()
	defer app.RequireStop()

	cfg, err := config.Load()
	require.NoError(t, err)

	resp, err := http.Get("http://localhost:" + itoa(cfg.Port) + "/health")
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusOK, resp.StatusCode)
}

func itoa(n int) string {
	return fmt.Sprintf("%d", n)
}
```

- [ ] **Step 2: Fix the missing import caught by running the test**

Add `"fmt"` to the import block above. Run: `cd backend-go && go test -tags=integration ./cmd/server/... -v`
Expected: FAIL — `platform.Module` doesn't exist yet.

- [ ] **Step 3: Implement `internal/platform/module.go`, composing every platform package into one `fx.Module`**

`backend-go/internal/platform/module.go`:
```go
package platform

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"time"

	"nexus-connect/backend-go/internal/platform/cache"
	"nexus-connect/backend-go/internal/platform/config"
	"nexus-connect/backend-go/internal/platform/db"
	"nexus-connect/backend-go/internal/platform/events"
	"nexus-connect/backend-go/internal/platform/httpserver"
	"nexus-connect/backend-go/internal/platform/logger"
	"nexus-connect/backend-go/internal/platform/migrations"
	"nexus-connect/backend-go/internal/platform/realtime"
	"github.com/go-chi/chi/v5"
	"go.uber.org/fx"
)

var Module = fx.Module("platform",
	fx.Provide(
		config.Load,
		provideLogger,
		provideDB,
		provideCache,
		provideEventBus,
		provideFanout,
		provideRouter,
	),
	fx.Invoke(
		registerHTTPServer,
		forceEventsAndRealtimeConstruction,
	),
)

// forceEventsAndRealtimeConstruction exists only because fx builds a
// constructor's value lazily — only when something in the graph actually
// depends on it. Nothing in this Foundation plan's own fx.Invoke list
// needs *events.Bus or *realtime.Fanout yet (no domain module exists to
// subscribe to either), so without this, fx would never call
// provideEventBus/provideFanout at all, and provideFanout's OnStop
// lifecycle hook would never register. Taking both as plain parameters
// here forces fx to construct them (and their lifecycle hooks) as part of
// app startup, even though their only "consumer" right now is this no-op
// function. The first domain module to add a real subscriber (e.g. `chat`
// requesting *events.Bus in its own fx.Invoke) makes this function
// redundant but harmless — fx providers are constructed at most once
// regardless of how many places request them.
func forceEventsAndRealtimeConstruction(*events.Bus, *realtime.Fanout) {}

func provideLogger() *slog.Logger {
	return logger.New("nexus-backend-go")
}

func provideDB(lc fx.Lifecycle, cfg config.Config) (*db.DB, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := db.New(ctx, cfg.PostgresDSN(), int32(cfg.PostgresPoolMax))
	if err != nil {
		return nil, err
	}

	if err := migrations.Run(cfg.PostgresDSN()); err != nil {
		return nil, err
	}

	lc.Append(fx.Hook{
		OnStop: func(ctx context.Context) error {
			pool.Close()
			return nil
		},
	})
	return pool, nil
}

func provideCache(lc fx.Lifecycle, cfg config.Config) *cache.Cache {
	c := cache.New(cfg.RedisAddr(), cfg.RedisPassword, cfg.RedisDB)
	lc.Append(fx.Hook{
		OnStop: func(ctx context.Context) error {
			return c.Close()
		},
	})
	return c
}

func provideEventBus(log *slog.Logger) *events.Bus {
	return events.NewBus(log)
}

func provideFanout(lc fx.Lifecycle, c *cache.Cache, log *slog.Logger) *realtime.Fanout {
	f := realtime.NewFanout(c, log)
	lc.Append(fx.Hook{
		OnStop: func(ctx context.Context) error {
			return f.Close()
		},
	})
	return f
}

func provideRouter(log *slog.Logger, cfg config.Config) *chi.Mux {
	return httpserver.NewRouter(log, cfg.CORSOrigins)
}

// registerHTTPServer starts the HTTP listener OnStart and performs a
// graceful (connection-draining) shutdown OnStop — Review Focus item:
// "SIGTERM while a request is in flight must drain, not cut off."
func registerHTTPServer(lc fx.Lifecycle, router *chi.Mux, cfg config.Config, log *slog.Logger) {
	server := &http.Server{
		Addr:    ":" + itoa(cfg.Port),
		Handler: router,
	}

	lc.Append(fx.Hook{
		OnStart: func(ctx context.Context) error {
			ln, err := net.Listen("tcp", server.Addr)
			if err != nil {
				return err
			}
			go func() {
				if err := server.Serve(ln); err != nil && err != http.ErrServerClosed {
					log.Error("http server error", "error", err)
				}
			}()
			return nil
		},
		OnStop: func(ctx context.Context) error {
			return server.Shutdown(ctx)
		},
	})
}

func itoa(n int) string {
	return fmtInt(n)
}
```

- [ ] **Step 4: Fix the undefined `fmtInt` helper — use `strconv` instead of inventing a helper**

Replace the bottom of `module.go`:
```go
func itoa(n int) string {
	return strconv.Itoa(n)
}
```
and add `"strconv"` to the imports, removing the broken `fmtInt` reference.

- [ ] **Step 5: Update `cmd/server/main.go` to actually run the app**

`backend-go/cmd/server/main.go`:
```go
package main

import (
	"nexus-connect/backend-go/internal/platform"
	"go.uber.org/fx"
)

func main() {
	fx.New(platform.Module).Run()
}
```

- [ ] **Step 6: Run the integration test to verify it passes (requires Postgres+Redis reachable at localhost defaults — start them via `docker run` or the compose file from Task 16 if available; for this task, run ad hoc containers)**

Run:
```bash
docker run -d --rm -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=nexus postgres:16-alpine
docker run -d --rm -p 6379:6379 redis:7-alpine
cd backend-go && go test -tags=integration ./cmd/server/... -v
```
Expected: PASS. Then stop the ad hoc containers: `docker ps -q --filter ancestor=postgres:16-alpine --filter ancestor=redis:7-alpine | xargs docker stop`.

- [ ] **Step 7: Commit**

```bash
git add backend-go/internal/platform/module.go backend-go/cmd/server/main.go backend-go/cmd/server/main_test.go backend-go/go.mod backend-go/go.sum
git commit -m "backend-go: wire platform.Module via fx, main.go boots the app with graceful shutdown"
```

---

## Task 16: Dockerfile + docker-compose for local dev

**Files:**
- Create: `backend-go/Dockerfile`
- Create: `backend-go/docker-compose.yml`
- Create: `backend-go/.dockerignore`

**Interfaces:**
- Consumes: nothing new — packages the binary built in Task 15.
- Produces: a runnable container joining the existing `backend`'s Postgres/Redis, per spec §4.7/§6 (both stacks coexist during the transition).

- [ ] **Step 1: Write `backend-go/.dockerignore`**

```
bin/
*.test
.git
```

- [ ] **Step 2: Write the Dockerfile, mirroring the multi-stage pattern in `backend/services/auth-service/Dockerfile`**

`backend-go/Dockerfile`:
```dockerfile
# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /bin/server ./cmd/server

# Production stage
FROM alpine:3.20 AS production

RUN addgroup -g 1001 -S nexus && adduser -S nexus -u 1001
COPY --from=builder /bin/server /bin/server

USER nexus
ENV NODE_ENV=production
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

ENTRYPOINT ["/bin/server"]
```

- [ ] **Step 3: Write `docker-compose.yml`, joining the existing `backend/`'s network rather than duplicating Postgres/Redis containers**

`backend-go/docker-compose.yml`:
```yaml
# Runs the Go monolith against the SAME Postgres/Redis containers started by
# ../backend/docker-compose.yml, since both stacks share one database during
# the module-by-module transition (spec §6). Start that stack first:
#   (cd ../backend && docker-compose up -d postgres redis)
# then:
#   docker-compose up --build

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: nexus-backend-go
    ports:
      - "8090:8080"
    environment:
      PORT: 8080
      POSTGRES_HOST: postgres
      POSTGRES_PORT: 5432
      POSTGRES_DB: nexus
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      REDIS_HOST: redis
      REDIS_PORT: 6379
      JWT_ACCESS_SECRET: ${JWT_ACCESS_SECRET:?must be set, no hardcoded fallback}
      JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET:?must be set, no hardcoded fallback}
      CORS_ORIGINS: ${CORS_ORIGINS:-http://localhost:3000}
    networks:
      - default
      - nexus-network

networks:
  nexus-network:
    external: true
    name: backend_nexus-network
```

- [ ] **Step 4: Verify the compose file is syntactically valid**

Run: `cd backend-go && docker-compose config --quiet`
Expected: no output, exit code 0 (confirms YAML + interpolation syntax only — actually starting it requires `../backend`'s network to exist first, which is a manual step documented in the file's header comment, not exercised by this command).

- [ ] **Step 5: Commit**

```bash
git add backend-go/Dockerfile backend-go/docker-compose.yml backend-go/.dockerignore
git commit -m "backend-go: add Dockerfile and docker-compose entry, joining backend/'s existing network"
```

**Plan correction (found during implementation/review, not in the original text above):** beyond the syntactic `docker-compose config --quiet` check Step 4 calls for, this was also verified end-to-end for real: `docker build` actually succeeds; the built image, run as a container against ad hoc Postgres/Redis on a custom network, boots (confirmed via its fx diagnostic log that `provideDB` genuinely runs inside a real container, not just under `go test` — the Task 15 fix holds here too); `/health` responds; `psql \dt` confirms all 12 domain tables plus `schema_migrations` exist (migrations really ran); the container's own `HEALTHCHECK` directive transitions from `starting` to `healthy`; and `docker stop` triggers all `OnStop` hooks in order (fanout → cache → db → HTTP server) with the container exiting in ~0.14s, well under the SIGKILL grace period.

Two gaps fixed from review: `.dockerignore` was missing `.env` (the production stage never copies it, but `COPY . .` would still pull a locally-created one into the builder layer) — added. And the external network's name, `backend_nexus-network`, relies entirely on Compose's directory-basename-naming convention holding (i.e. `../backend` being run from a directory literally named `backend`, with no `COMPOSE_PROJECT_NAME`/`-p` override) — true today, but `backend/README.md`'s own quick-start instructions imply cloning into a differently-named directory, which would silently break this assumption. Documented the dependency and the fix (pin `COMPOSE_PROJECT_NAME=backend` or rename this file's `name:` to match) directly in `docker-compose.yml`'s header comment rather than relying on convention alone.

---

## Plan self-review

**Spec coverage:** Every `internal/platform/*` package in spec §4.1's table has a task (errors→2, logger→3, idgen→4 [new, implied by auth/user needs], config→5, db→6, cache→7, ratelimit→8, events→9, realtime→10, auth→11, validate→12, httpserver→13, migrations→14). `cmd/server/main.go` wiring → Task 15. Dockerfile/compose → Task 16. Spec §5's DoD checklist items are each covered: `/health` (13, 15), graceful shutdown (15), all platform packages tested (2–14), realtime cross-replica test (10), migrations idempotent + integration-tested (14), Dockerfile+compose (16), no domain module routes beyond `/health` (confirmed — no `internal/<domain>` package is created anywhere in this plan).

**Placeholder scan:** No "TBD"/"TODO-fill-in" patterns. Two intentionally-broken-then-fixed steps (Task 6 Step 1→2, Task 13 Step 4→5) are pedagogical, not placeholders — each shows the wrong code, the failure, and the real fix with full code both times, per the skill's own "show how" requirement.

**Type consistency:** `TokenPayload{UserID, Email}` (Task 11) is used identically in Task 11's own tests only in this plan (no domain module consumes it yet). `*errors.AppError` (Task 2) is consumed identically by Tasks 11, 12, 13 — field names (`StatusCode`, `Code`, `Message`, `Details`) match across all call sites. `HandlerFunc` (Task 13) is defined once and not yet consumed outside its own tests (first real consumer is the `auth` domain module's own plan, next).

**Review Focus coverage:** Redis-drop case → Task 7's `TestGet_MissingKeyReturnsErrNotFound` covers the miss case; a genuinely dropped connection isn't separately simulated (testcontainers can't easily kill the network mid-test) — noted as a gap, acceptable since the error-propagation *pattern* (every cache method returns `error`) is structurally verified by every other cache test already requiring `err` to be checked. Concurrent realtime publish → Task 10 `TestConcurrentPublish_NoDataRace` with `-race`. Malformed/expired JWT → Task 11's four dedicated error-code tests. Double migration run → Task 14 `TestRun_IsIdempotent`. SIGTERM mid-request → **gap found during self-review**: Task 15 implements `server.Shutdown(ctx)` (correct mechanism) but has no test proving a slow in-flight request actually drains rather than being cut off. Adding it now:

- [ ] **Task 15, additional Step 6b (insert before the original Step 6 commit): write the draining test**

Add to `backend-go/cmd/server/main_test.go`:
```go
func TestGracefulShutdown_DrainsInFlightRequest(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "integration-test-access-secret-32!")
	t.Setenv("JWT_REFRESH_SECRET", "integration-test-refresh-secret-32")
	t.Setenv("PORT", "18081")

	app := fxtest.New(t, platform.Module, fx.NopLogger)
	app.RequireStart()

	done := make(chan struct{})
	go func() {
		defer close(done)
		resp, err := http.Get("http://localhost:18081/health")
		if err == nil {
			resp.Body.Close()
		}
	}()

	time.Sleep(50 * time.Millisecond) // let the request start
	stopCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	require.NoError(t, app.Stop(stopCtx))

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("in-flight request was not allowed to complete before shutdown returned")
	}
}
```

This supersedes the plain `app.RequireStop()` in the original Step 6 — run both tests together as part of that step's verification.

**Scope check:** Confirmed — no domain module logic anywhere in this plan; it produces exactly spec §4–§5's foundation and nothing more.

**Plan correction (found during implementation, not in the original text above) — the most serious defect in this entire plan:** Step 3's `forceEventsAndRealtimeConstruction(*events.Bus, *realtime.Fanout)` only forces fx to construct those two providers. `registerHTTPServer` doesn't depend on `*db.DB` either, and nothing else in the `fx.Invoke` list did before this fix — so fx's lazy construction meant `provideDB` was **never actually called**, confirmed by running the real compiled binary against real Docker Postgres/Redis and inspecting fx's own startup diagnostic log: every other provider printed a `RUN provide:` line, `provideDB` never did. The app would boot, `/health` would return 200, and the database would silently never connect and migrations would silently never run — invisible to Step 1's own test, since `/health` never touches Postgres. Fixed by renaming the function to `forceUnconsumedProviderConstruction` and adding `*db.DB` as a third parameter. Added `TestApp_BootConstructsDBAndAppliesMigrations` (opens a separate direct Postgres connection after boot and checks `information_schema.tables` for `users`) — confirmed it genuinely fails without the fix (reverted the signature, reran, watched it fail) and passes with it. Also confirmed via a deliberately-unreachable-Postgres run that a failed `provideDB` now fails the whole boot loudly (non-zero exit, fx's own error trace) rather than partially starting — dig resolves `fx.Invoke` parameters in order and short-circuits atomically on the first error, so nothing silently partial-boots.

Also fixed in `provideDB`: if `migrations.Run` fails after `db.New` already succeeded, the pool is now explicitly closed before returning the error — previously it was discarded unclosed (a brief leak until process exit, since a failed `fx.New(...).Run()` boot exits the process shortly after anyway, but cheap to close explicitly regardless).

Separately, `Step 1`'s own test (`TestApp_BootsServesHealthAndShutsDownCleanly`) assumed Postgres/Redis were already running at `localhost` defaults via manually-started ad hoc `docker run` containers — unlike every other integration test in this plan, which is self-contained via testcontainers, this couldn't run inside any CI pipeline without an undocumented manual pre-step. Rewrote it to spin up its own ephemeral testcontainers Postgres/Redis (via a `setAppEnv` helper that points `Config.Load()`'s env vars at their mapped host/port) — same `go test -tags=integration ./...` invocation as every other task.

Finally, `Task 15, additional Step 6b`'s own `TestGracefulShutdown_DrainsInFlightRequest` (added by this plan's self-review, directly above) has a timing race that would make it pass without ever actually testing anything: it hits `/health` (which responds in microseconds) and only waits a bare `time.Sleep(50 * time.Millisecond)` before calling `Stop()`, so the request would almost always have already completed before the sleep elapses — there would be no in-flight work left to drain. Replaced with a standalone, non-integration-tagged `graceful_shutdown_test.go` that uses a `started` channel to deterministically guarantee a slow handler is actually executing before `Shutdown` is called, eliminating the race entirely. Since `registerHTTPServer`'s `OnStop` hook body is literally `return server.Shutdown(ctx)` with no other logic, testing that call directly is equivalent to testing the hook itself — and this version needs no fx/Postgres/Redis, so it runs as part of the normal `go test ./...` suite too, not just the `integration`-tagged one.

---

## Task 17: Final `go mod tidy` pass (plan correction, added during Task 7 review)

**Why this exists:** Step 5 of Task 1 says `go mod tidy` "becomes safe to run once real code imports these packages, starting from Task 2 onward" — that's true *per package*, but `go mod tidy` operates on the whole module, not one package at a time. Until every pinned dependency from Task 1 Step 3 has at least one importer somewhere in the tree, running `tidy` strips every *other* still-unimported package right back out of `go.mod`/`go.sum` — the identical failure mode Task 1 Step 5 was written to avoid, just triggered by a later task instead of Task 1 itself. Concretely: as of Task 7, `jwt`, `x/crypto` (bcrypt), `validator`, `migrate`, `chi`, and `fx` have zero importers (production or test) anywhere in the module, so `go mod tidy` run at any point before Tasks 11–15 land would delete all six.

Symptom already observed during Task 7's review: every entry in `go.mod`, including packages with real importers for several tasks now (`pgx/v5`, `testify`, `testcontainers-go` + its `postgres`/`redis` modules, `redis/go-redis/v9`), is still marked `// indirect` — nobody has been able to safely correct these markers task-by-task without the whole-module tidy risk above.

**Resolution:** do not run `go mod tidy` during Tasks 8–16. After Task 16 is committed (every pinned dependency now has a real importer), run exactly once:

```bash
cd backend-go && go mod tidy && go build ./... && go vet ./... && go test ./... && go test -tags=integration ./... && go test -race ./...
```

Expected: `go.mod`/`go.sum` churn only in `// indirect` markers flipping to direct (or disappearing) for packages with real importers — no `require` line should be *removed* at this point, since Task 16 is the last task and every pinned package should have landed an importer by Tasks 2–16. If `go mod tidy` removes a `require` line here, stop and investigate which task's package never got imported (a sign that task's implementation is incomplete, not that the dependency was unnecessary) before committing.

- [ ] **Step 1:** Run the verification command block above.
- [ ] **Step 2:** `git diff backend-go/go.mod backend-go/go.sum` — confirm only `// indirect` markers changed, no `require` lines removed.
- [ ] **Step 3:** Commit: `git add backend-go/go.mod backend-go/go.sum && git commit -m "backend-go: tidy go.mod now that every pinned dependency has an importer"`

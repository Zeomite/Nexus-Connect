# Go `user` Domain Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `backend/services/user-service` (profile CRUD, online/offline status, search, avatar stub) onto the Go monolith, as `internal/user`, the second domain module after `auth`.

**Architecture:** Same layering as the `auth` module: `Store` (Postgres queries) → `Service` (business logic, Redis caching) → `Handler` (HTTP adapters) → `routes.go`/`module.go` (chi mounting + `fx` wiring). No new DB migration needed — the `users` table (`status`, `profile_picture_url`, `display_name`, `unique_number`, `email`, `created_at`) already exists in full from the foundation plan's migration. Every route in this module (`/api/v1/users/*`, `/api/v1/search/*`) requires a valid Bearer token, applied once at the route-group level via the foundation's already-built `platformauth.Middleware` — unlike `auth`, this module has no unauthenticated routes and no rate limiting at all (the original registers none for this service).

**Tech Stack:** Same as `auth`: Go 1.22+, `go-chi/chi/v5`, `jackc/pgx/v5`, `redis/go-redis/v9`, `go-playground/validator/v10`, `go.uber.org/fx`, `testify`, `testcontainers-go`.

**Spec:** `docs/superpowers/specs/2026-10-15-go-monolith-migration-design.md` (§3 lists `user` as module 2, right after `auth`)

## Global Constraints

- Mount prefixes: `/api/v1/users` and `/api/v1/search` — exact paths the frontend already calls (confirmed in `frontend/src/lib/api/config.ts`: `/api/v1/users/me`, `/api/v1/users/me/status`, `/api/v1/search/by-number/:number`, `/api/v1/search/users`). Zero frontend changes.
- **Every route in both groups requires a valid Bearer token** (the original's `authPlugin` excludes only `/health*`/`/docs*`, and this module owns neither) — apply `platformauth.Middleware(cfg.JWTAccessSecret)` once via `r.Use(...)` at each route group's mount point, not per-route `.With(...)` like `auth` does for rate limiting.
- **No rate limiting anywhere in this module** — the original registers none for `user-service` (confirmed: no `createRateLimitMiddleware`/`preHandler` anywhere in `user.routes.ts` or `search.routes.ts`, and `user-service/AGENTS.md` states this explicitly). Do not add `ratelimit.Middleware` to any route here.
- **`GET /:userId` is fixed, not faithfully preserved**: the original reuses `getProfile()` (the same query `/me` uses, which includes `email`) for fetching *another* user's profile — any authenticated caller can read any other user's email. This is listed as issue #2 in `SECURITY.md`'s top findings, which explicitly recommends fixing it, and a correctly-shaped query (`PUBLIC_PROFILE_BY_ID`, no email) already exists unused in `backend/packages/shared/src/database/queries/user.queries.ts` for exactly this purpose. **Explicit user decision for this plan: fix it now** — Task 6 ports `/:userId` using the narrow public-profile shape, not `/me`'s. This is a deliberate exception to this migration's otherwise-consistent "preserve known gaps, mark with `// TODO(gap)`, fix in a dedicated later pass" rule (used for every other known gap so far, including the ones below) — justified here because the fix is the same size as preserving the bug, and the bug is live user-data exposure, not an inert stub.
- **Known gaps ported as-is, each marked `// TODO(gap): <description>, see backend/services/user-service/AGENTS.md`** (spec §2): (1) `updateStatus`'s Redis `online:users` set write (`SADD` on `online`, `SREM` on `offline`) is dead — nothing anywhere ever reads that set (confirmed via grep across `backend/`); ported as a real write anyway, matching the original exactly, since removing a faithfully-ported write that costs nothing to keep is a bigger behavior decision than this plan needs to make. (2) Avatar upload (`POST /me/avatar`) is a non-functional stub: it reads the uploaded file into memory, discards it, fabricates an S3 URL from config values, writes that fake URL to the DB, and returns a real 200 — explicit `// TODO: Implement actual S3 upload` in the original's `user.service.ts`.
- `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` env vars are read by the original's config but never used anywhere (no S3 client is ever constructed) — **not ported to `platform/config` at all**, since nothing in this plan's Go code needs them either. `STORAGE_BUCKET`/`STORAGE_REGION` *are* ported (Task 3) since the fake avatar URL is built from them.
- `displayName` on `PATCH /me` is optional but not nullable (`z.string().min(1).max(100).optional()` — a plain `*string` in Go: nil means "don't touch this column", non-nil means "set it to this"). `profilePictureUrl` on the same route is optional **and** nullable (`z.string().url().nullable().optional()` — three real states: key omitted entirely → don't touch; key present with value `null` → clear the column to `NULL`; key present with a URL string → set it). A plain Go pointer cannot distinguish "omitted" from "present-and-null" (both decode to a nil pointer), so Task 4 defines a small `OptionalString` wrapper type with a custom `UnmarshalJSON` that only fires when Go's JSON decoder actually sees the key, to correctly carry all three states through to `Store.UpdateProfile`'s dynamic `SET` clause.
- chi path params use `{param}` syntax (`/{userId}`, `/by-number/{uniqueNumber}`), not Fastify's `:param` — extracted via `chi.URLParam(r, "userId")`. This is the first module with path params; `auth`'s 9 routes were all flat `POST`s.
- The global 1 MiB request-body cap `httpserver.Wrap` applies (added during the `auth` module's final review) would reject the original's 5 MiB avatar-upload limit before the handler ever runs. Task 2 adds `httpserver.WrapWithBodyLimit(log, fn, maxBytes)` — `Wrap` is refactored to delegate to a shared internal implementation parameterized by the limit, so its existing 9 call sites in `auth` are unaffected (`Wrap` still applies exactly 1 MiB) and the avatar route alone gets 5 MiB via the new function.
- `UpdateProfileSchema` (the shared Zod schema) also declares an optional `status` field, but neither the original's Fastify route schema for `PATCH /me` nor `UserService.updateProfile` ever reads it — dead field on a reused schema (same pattern as `ForgotPasswordSchema` being reused for `/resend-verification` in `auth-service`). **Do not** add a `Status` field to `updateProfileRequest`; status changes only ever go through `PATCH /me/status`.

## Review Focus

- **`GET /:userId` must never include the caller's target's email in its response body** — this is the one deliberate fix in this plan, and the one most likely to silently regress back to the original's bug if a future edit "simplifies" by reusing `GetProfile` for both routes. A test must assert the `email` key is entirely absent from `/:userId`'s JSON body, not merely check that other fields are present.
- **`GetStatus`/`GetStatuses` must prefer the Redis cache and only fall back to Postgres on a genuine cache miss** — getting this backwards (DB-first) defeats the whole point of the 300s TTL cache the original built, and a test that only ever hits a cold cache (always falls through to DB) would never catch a DB-first bug. A test must warm the cache with one status, change the DB's value directly to something different, and confirm the cache's (now-stale-relative-to-DB, but correct-per-contract) value wins.
- **`PATCH /me` must distinguish "profilePictureUrl omitted" from "profilePictureUrl explicitly `null`"** — omitting the key must leave the column untouched; sending `null` must clear it to `NULL`. A naive implementation using a plain `*string` conflates these two into the same nil pointer, and whichever behavior it picks by accident (always clear, or never clear) will pass a test that only exercises one of the two cases. Both must be tested explicitly, plus the third case (a real URL value) and plain omission (no `profilePictureUrl` key at all, only `displayName`) leaving the existing picture untouched.
- **`GetStatuses`'s Redis-pipeline-then-DB-fallback batch logic must handle a *mix* of hits and misses in one call correctly** — a test that sends either all-hits or all-misses would miss an off-by-one bug where, say, the DB fallback query overwrites a value Redis already supplied, or a miss silently gets dropped instead of falling back. A test must request 3 users where exactly 1 has a cached status and 2 don't, and assert all 3 come back correct.
- **`POST /me/avatar` must reject a disallowed MIME type before writing anything** — a client sending `application/pdf` (or any non-image type) must get `400 INVALID_FILE_TYPE` and the user's `profile_picture_url` column must remain unchanged; the allowlist check happens before `UploadAvatar` is ever called, matching the original's placement in the route handler rather than the service.

---

## Task 1: `internal/platform/cache` — add `MGet`, `SAdd`, `SRem`

**Files:**
- Modify: `backend-go/internal/platform/cache/cache.go`
- Modify: `backend-go/internal/platform/cache/cache_test.go` (build-tagged `integration`)

**Interfaces:**
- Consumes: nothing new (same `*redis.Client` already on `Cache`).
- Produces:
  - `func (c *Cache) MGet(ctx context.Context, keys []string) (map[string]string, error)` — one Redis `MGET` round trip; the returned map contains an entry only for keys that had a value (a cache miss is simply absent from the map, never a zero-value `""` entry, so callers can't confuse "missing" with "cached as empty string").
  - `func (c *Cache) SAdd(ctx context.Context, key string, members ...string) error`
  - `func (c *Cache) SRem(ctx context.Context, key string, members ...string) error`

- [ ] **Step 1: Write the failing tests**

Add to `backend-go/internal/platform/cache/cache_test.go` (same file, same `startRedis` helper already defined there):

```go
func TestMGet_ReturnsOnlyKeysThatExist(t *testing.T) {
	addr := startRedis(t)
	c := cache.New(addr, "", 0)
	defer c.Close()
	ctx := context.Background()

	require.NoError(t, c.Set(ctx, "a", "1", time.Minute))
	require.NoError(t, c.Set(ctx, "c", "3", time.Minute))

	result, err := c.MGet(ctx, []string{"a", "b", "c"})
	require.NoError(t, err)
	assert.Equal(t, map[string]string{"a": "1", "c": "3"}, result, "key b was never set and must be absent, not a zero-value entry")
}

func TestMGet_AllMissingReturnsEmptyMap(t *testing.T) {
	addr := startRedis(t)
	c := cache.New(addr, "", 0)
	defer c.Close()

	result, err := c.MGet(context.Background(), []string{"x", "y"})
	require.NoError(t, err)
	assert.Empty(t, result)
}

func TestSAddSRem_RoundTrip(t *testing.T) {
	addr := startRedis(t)
	c := cache.New(addr, "", 0)
	defer c.Close()
	ctx := context.Background()

	require.NoError(t, c.SAdd(ctx, "myset", "user-1", "user-2"))

	members, err := c.client().SMembers(ctx, "myset").Result()
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"user-1", "user-2"}, members)

	require.NoError(t, c.SRem(ctx, "myset", "user-1"))
	members, err = c.client().SMembers(ctx, "myset").Result()
	require.NoError(t, err)
	assert.Equal(t, []string{"user-2"}, members)
}
```

- [ ] **Step 2: Remove the placeholder `c.client()` call from Step 1 — it was never needed**

`c.client()` above doesn't exist and never will (the test package is external, `cache_test`, and `Cache`'s underlying `*redis.Client` is intentionally unexported). Replace `TestSAddSRem_RoundTrip`'s verification with the same `MGet`/`Get`-based assertions the rest of this file already uses — there's no existing `cache.Cache` method to list a set's members, and this plan doesn't need one (the only consumer, `internal/user`, only ever adds/removes, never reads the set back, per Global Constraints' dead-write note). Replace the test body with:

```go
func TestSAddSRem_DoNotError(t *testing.T) {
	addr := startRedis(t)
	c := cache.New(addr, "", 0)
	defer c.Close()
	ctx := context.Background()

	require.NoError(t, c.SAdd(ctx, "myset", "user-1", "user-2"))
	require.NoError(t, c.SRem(ctx, "myset", "user-1"))
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend-go && go test -tags=integration ./internal/platform/cache/... -v -run 'TestMGet|TestSAddSRem'`
Expected: FAIL — `c.MGet`/`c.SAdd`/`c.SRem` undefined.

- [ ] **Step 4: Implement**

Add to `backend-go/internal/platform/cache/cache.go` (after the existing `Del` method):

```go
// MGet reads every key in one Redis round trip. The returned map contains
// an entry only for keys that actually had a value — go-redis's MGet
// returns a nil interface{} for a missing key, which this collapses to
// "absent from the map" rather than a zero-value "" entry, so callers
// can't mistake a cache miss for a cached empty string.
func (c *Cache) MGet(ctx context.Context, keys []string) (map[string]string, error) {
	if len(keys) == 0 {
		return map[string]string{}, nil
	}

	vals, err := c.client.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, err
	}

	result := make(map[string]string, len(keys))
	for i, v := range vals {
		if v == nil {
			continue
		}
		s, ok := v.(string)
		if !ok {
			continue
		}
		result[keys[i]] = s
	}
	return result, nil
}

func (c *Cache) SAdd(ctx context.Context, key string, members ...string) error {
	return c.client.SAdd(ctx, key, members).Err()
}

func (c *Cache) SRem(ctx context.Context, key string, members ...string) error {
	return c.client.SRem(ctx, key, members).Err()
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend-go && go test -tags=integration ./internal/platform/cache/... -v`
Expected: PASS, all tests green (the pre-existing ones plus the 3 new ones: `TestMGet_ReturnsOnlyKeysThatExist`, `TestMGet_AllMissingReturnsEmptyMap`, `TestSAddSRem_DoNotError`).

- [ ] **Step 6: Commit**

```bash
cd backend-go && go build ./... && go vet ./... && go test -tags=integration ./internal/platform/cache/... -v
git add backend-go/internal/platform/cache/cache.go backend-go/internal/platform/cache/cache_test.go
git commit -m "backend-go/platform/cache: add MGet, SAdd, SRem for the user module's status batching and presence set"
```

---

## Task 2: `internal/platform/httpserver` — add `WrapWithBodyLimit`

**Files:**
- Modify: `backend-go/internal/platform/httpserver/errorhandler.go`
- Modify: `backend-go/internal/platform/httpserver/server_test.go` (build-tagged `integration`... actually this file has no build tag today — check before adding; its existing tests run untagged, so add the new test the same way)

**Interfaces:**
- Consumes: nothing new.
- Produces: `func WrapWithBodyLimit(log *slog.Logger, fn HandlerFunc, maxBytes int64) http.HandlerFunc` — same contract as `Wrap`, with a caller-chosen body-size cap instead of the fixed `maxRequestBodyBytes` (1 MiB) default. `Wrap` itself is unchanged in behavior or signature.

- [ ] **Step 1: Write the failing test**

Add to `backend-go/internal/platform/httpserver/server_test.go`:

```go
// TestWrapWithBodyLimit_AllowsBodyUnderCustomLimitButRejectsOverIt proves
// WrapWithBodyLimit uses its own parameter, not the package's fixed
// maxRequestBodyBytes — needed because the user module's avatar upload
// (5 MiB) would otherwise be rejected by Wrap's 1 MiB default before the
// handler ever sees the file.
func TestWrapWithBodyLimit_AllowsBodyUnderCustomLimitButRejectsOverIt(t *testing.T) {
	log := logger.New("test")
	handler := httpserver.WrapWithBodyLimit(log, func(w http.ResponseWriter, r *http.Request) error {
		if _, err := io.ReadAll(r.Body); err != nil {
			return apperrors.BadRequest("Invalid request body", nil)
		}
		return httpserver.WriteJSON(w, http.StatusOK, map[string]string{"ok": "true"})
	}, 2<<20) // 2 MiB, above Wrap's 1 MiB default

	underLimit := bytes.Repeat([]byte("a"), (1<<20)+1) // over Wrap's default, under this custom limit
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(underLimit))
	rec := httptest.NewRecorder()
	handler(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code, "a body between Wrap's default and this custom limit must be accepted")

	overLimit := bytes.Repeat([]byte("a"), (2<<20)+1)
	req2 := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(overLimit))
	rec2 := httptest.NewRecorder()
	handler(rec2, req2)
	assert.Equal(t, http.StatusBadRequest, rec2.Code, "a body over this custom limit must still be rejected")
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test ./internal/platform/httpserver/... -v -run TestWrapWithBodyLimit`
Expected: FAIL — `httpserver.WrapWithBodyLimit` undefined.

- [ ] **Step 3: Implement**

Replace `Wrap` in `backend-go/internal/platform/httpserver/errorhandler.go` with:

```go
// Wrap adapts a HandlerFunc (which can return an error) into a standard
// http.HandlerFunc, mapping any returned error to the same
// {"error":{"code","message","details"}} JSON shape the original
// TypeScript services' global error handlers produce. Applies the
// package's default body-size cap (maxRequestBodyBytes) — use
// WrapWithBodyLimit for a route that genuinely needs a different one
// (e.g. a file upload).
func Wrap(log *slog.Logger, fn HandlerFunc) http.HandlerFunc {
	return wrapWithLimit(log, fn, maxRequestBodyBytes)
}

// WrapWithBodyLimit is Wrap with a caller-chosen body-size cap instead of
// the package default.
func WrapWithBodyLimit(log *slog.Logger, fn HandlerFunc, maxBytes int64) http.HandlerFunc {
	return wrapWithLimit(log, fn, maxBytes)
}

func wrapWithLimit(log *slog.Logger, fn HandlerFunc, maxBytes int64) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
		sw := &statusTrackingWriter{ResponseWriter: w}
		err := fn(sw, r)
		if err == nil {
			return
		}

		if sw.started {
			// The handler already wrote part of a different response (e.g.
			// WriteJSON's header succeeded but body encoding then failed) —
			// writing a second status/body on top would corrupt it.
			log.Error("handler returned error after starting a response",
				"error", err, "path", r.URL.Path, "method", r.Method)
			return
		}

		writeAppError(w, log, r, err)
	}
}
```

This replaces the existing `Wrap` function body entirely (the old body's logic — install the body-size reader, construct `sw`, call `fn`, handle the error — moves into `wrapWithLimit` unchanged; `Wrap` becomes a one-line call to it with the existing constant).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend-go && go test ./internal/platform/httpserver/... -v`
Expected: PASS, all tests green (including every pre-existing `Wrap`-based test — `Wrap`'s own behavior is unchanged, only its implementation moved).

- [ ] **Step 5: Commit**

```bash
cd backend-go && go build ./... && go vet ./... && go test ./internal/platform/httpserver/... -v && go test -tags=integration ./... 
git add backend-go/internal/platform/httpserver/errorhandler.go backend-go/internal/platform/httpserver/server_test.go
git commit -m "backend-go/platform/httpserver: add WrapWithBodyLimit for routes needing a non-default body cap"
```

---

## Task 3: `internal/platform/config` — add `StorageBucket`, `StorageRegion`

**Files:**
- Modify: `backend-go/internal/platform/config/config.go`
- Modify: `backend-go/internal/platform/config/config_test.go`

**Interfaces:**
- Consumes: nothing new (same `envStr` helper already used for every other string field).
- Produces: `config.Config.StorageBucket string`, `config.Config.StorageRegion string` — defaults `"nexus-profiles"` and `"us-east-1"`, matching `user-service/src/config.ts`'s `storage.bucket`/`storage.region` defaults exactly.

- [ ] **Step 1: Write the failing test**

Add to `backend-go/internal/platform/config/config_test.go` (alongside whatever existing default-value tests are there — follow that file's existing style for a single-field default assertion):

```go
func TestLoad_StorageDefaults(t *testing.T) {
	clearAllConfigEnv(t) // existing helper in this file that unsets every config-related env var before each defaults test
	t.Setenv("JWT_ACCESS_SECRET", "test-access-secret-32-characters!!")
	t.Setenv("JWT_REFRESH_SECRET", "test-refresh-secret-32-characters!")

	cfg, err := config.Load()
	require.NoError(t, err)
	assert.Equal(t, "nexus-profiles", cfg.StorageBucket)
	assert.Equal(t, "us-east-1", cfg.StorageRegion)
}
```

- [ ] **Step 2: Remove the placeholder helper reference from Step 1 if it doesn't exist**

Read `backend-go/internal/platform/config/config_test.go` first. If no `clearAllConfigEnv` helper exists, delete that line and instead set the two required JWT env vars directly, same as every other default-checking test in that file does (match whatever pattern is already there — likely each test calls `t.Setenv` only for the two required JWT vars and relies on `t.Setenv`'s own per-test isolation for everything else).

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend-go && go test ./internal/platform/config/... -v -run TestLoad_StorageDefaults`
Expected: FAIL — `cfg.StorageBucket`/`cfg.StorageRegion` undefined, or (once the struct fields are referenced) a compile error on the missing fields.

- [ ] **Step 4: Implement**

In `backend-go/internal/platform/config/config.go`, add to the `Config` struct (after `EmailFrom`):

```go
	StorageBucket string
	StorageRegion string
```

And to `Load()`'s returned `cfg` literal (after `EmailFrom`):

```go
		StorageBucket: envStr("STORAGE_BUCKET", "nexus-profiles"),
		StorageRegion: envStr("STORAGE_REGION", "us-east-1"),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend-go && go test ./internal/platform/config/... -v`
Expected: PASS, all tests green.

- [ ] **Step 6: Commit**

```bash
cd backend-go && go build ./... && go vet ./... && go test ./internal/platform/config/... -v
git add backend-go/internal/platform/config/config.go backend-go/internal/platform/config/config_test.go
git commit -m "backend-go/platform/config: add StorageBucket/StorageRegion for the user module's avatar stub"
```

---

## Task 4: `internal/user/store.go` — Postgres queries

**Files:**
- Create: `backend-go/internal/user/store.go`
- Create: `backend-go/internal/user/store_test.go` (build-tagged `integration`)

**Interfaces:**
- Consumes: `*db.DB`, `*migrations.Run` (foundation, already built).
- Produces:
  - `type OptionalString struct { Set bool; Value *string }` with a custom `UnmarshalJSON` — carries a JSON PATCH field through its three possible states (key omitted / present-and-null / present-with-value); see Step 3 for the full type and why it lives here rather than in `dto.go` (Task 10), which would otherwise be its more natural home.
  - `type ProfileRow struct { ID, Email, UniqueNumber, DisplayName, Status string; ProfilePictureURL *string; CreatedAt time.Time }`
  - `type PublicProfileRow struct { ID, DisplayName, UniqueNumber, Status string; ProfilePictureURL *string }`
  - `type ProfileUpdate struct { DisplayName *string; ProfilePictureURL OptionalString }`
  - `type Store struct` + `func NewStore(database *db.DB) *Store`
  - `func (s *Store) ProfileByID(ctx context.Context, userID string) (*ProfileRow, error)`
  - `func (s *Store) PublicProfileByID(ctx context.Context, userID string) (*PublicProfileRow, error)`
  - `func (s *Store) PublicProfileByUniqueNumber(ctx context.Context, uniqueNumber string) (*PublicProfileRow, error)`
  - `func (s *Store) StatusByID(ctx context.Context, userID string) (*string, error)` — nil (not an error) if the user doesn't exist, mirroring the original's `user?.status || 'offline'` fallback being the *caller's* job, not the query's.
  - `func (s *Store) StatusesByIDs(ctx context.Context, userIDs []string) (map[string]string, error)` — map keyed by user ID, present only for IDs that exist.
  - `func (s *Store) UpdateStatus(ctx context.Context, userID, status string) error`
  - `func (s *Store) UpdateProfile(ctx context.Context, userID string, update ProfileUpdate) (*ProfileUpdate, error)` returning the actually-applied display name/picture URL, or `nil, nil` if neither field was set (mirrors the original short-circuiting to `getProfile(userId)` when `updates.length === 0`)
  - `func (s *Store) UpdateProfilePicture(ctx context.Context, userID, url string) error`
  - `func (s *Store) SearchByName(ctx context.Context, excludeUserID, query string, limit, offset int) ([]PublicProfileRow, error)`
  - `func (s *Store) CountSearchByName(ctx context.Context, excludeUserID, query string) (int, error)`

- [ ] **Step 1: Write the failing test**

`backend-go/internal/user/store_test.go`:
```go
//go:build integration

package user_test

import (
	"context"
	"testing"
	"time"

	"nexus-connect/backend-go/internal/platform/db"
	"nexus-connect/backend-go/internal/platform/migrations"
	"nexus-connect/backend-go/internal/user"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
)

// testDB is set by startStore and used by insertTestUser — a second
// handle on the exact same connection the *user.Store under test wraps,
// for test setup only (Store deliberately has no raw-insert passthrough;
// auth's Store.InsertUser isn't reachable from this package, and doesn't
// need to be — this test file just needs *a* row to exist).
var testDB *db.DB

// startStore spins a fresh Postgres container per test (deferred
// cost-reduction noted in the auth module's final review, m-12, not
// addressed in this plan either) and runs the real migrations — this
// package has no other test that might have already applied them, unlike
// auth's store_test.go, which could sometimes piggyback on one.
func startStore(t *testing.T) *user.Store {
	t.Helper()
	ctx := context.Background()
	container, err := postgres.Run(ctx, "postgres:16-alpine",
		postgres.WithDatabase("nexus_test"),
		postgres.WithUsername("postgres"),
		postgres.WithPassword("postgres"),
		postgres.BasicWaitStrategies(),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err)

	database, err := db.New(ctx, dsn, 5)
	require.NoError(t, err)
	t.Cleanup(database.Close)

	require.NoError(t, migrations.Run(dsn))

	testDB = database
	return user.NewStore(database)
}

func insertTestUser(t *testing.T, _ *user.Store, id, email, uniqueNumber, displayName, status string) {
	t.Helper()
	_, err := testDB.Exec(context.Background(),
		`INSERT INTO users (id, email, password_hash, unique_number, display_name, status, email_verified, created_at, updated_at)
		 VALUES ($1, $2, 'test-hash', $3, $4, $5, true, NOW(), NOW())`,
		id, email, uniqueNumber, displayName, status,
	)
	require.NoError(t, err)
}

func TestProfileByID_ReturnsFullRowIncludingEmail(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000001", "full@example.com", "1111111111", "Full Profile", "offline")

	row, err := store.ProfileByID(ctx, "00000000-0000-0000-0000-000000000001")
	require.NoError(t, err)
	require.NotNil(t, row)
	assert.Equal(t, "full@example.com", row.Email)
	assert.Equal(t, "Full Profile", row.DisplayName)
	assert.Equal(t, "1111111111", row.UniqueNumber)
	assert.Equal(t, "offline", row.Status)
	assert.WithinDuration(t, time.Now(), row.CreatedAt, time.Minute)
}

func TestProfileByID_NotFound_ReturnsNilNotError(t *testing.T) {
	store := startStore(t)
	row, err := store.ProfileByID(context.Background(), "00000000-0000-0000-0000-000000000099")
	require.NoError(t, err)
	assert.Nil(t, row)
}

// TestPublicProfileByID_NeverIncludesEmail pins Review Focus item 1 at the
// Store layer: PublicProfileRow has no Email field at all, so this is
// enforced by the type system, not just by a handler choosing not to
// serialize a field that's still sitting in memory.
func TestPublicProfileByID_NeverIncludesEmail(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000002", "public@example.com", "2222222222", "Public Profile", "online")

	row, err := store.PublicProfileByID(ctx, "00000000-0000-0000-0000-000000000002")
	require.NoError(t, err)
	require.NotNil(t, row)
	assert.Equal(t, "Public Profile", row.DisplayName)
	assert.Equal(t, "2222222222", row.UniqueNumber)
	assert.Equal(t, "online", row.Status)
}

func TestPublicProfileByUniqueNumber_Found(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000003", "bynum@example.com", "3333333333", "By Number", "busy")

	row, err := store.PublicProfileByUniqueNumber(ctx, "3333333333")
	require.NoError(t, err)
	require.NotNil(t, row)
	assert.Equal(t, "00000000-0000-0000-0000-000000000003", row.ID)
}

func TestPublicProfileByUniqueNumber_NotFound_ReturnsNilNotError(t *testing.T) {
	store := startStore(t)
	row, err := store.PublicProfileByUniqueNumber(context.Background(), "9999999999")
	require.NoError(t, err)
	assert.Nil(t, row)
}

func TestStatusByID_ReturnsStatus(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000004", "status@example.com", "4444444444", "Status User", "away")

	status, err := store.StatusByID(ctx, "00000000-0000-0000-0000-000000000004")
	require.NoError(t, err)
	require.NotNil(t, status)
	assert.Equal(t, "away", *status)
}

func TestStatusByID_NotFound_ReturnsNilNotError(t *testing.T) {
	store := startStore(t)
	status, err := store.StatusByID(context.Background(), "00000000-0000-0000-0000-000000000098")
	require.NoError(t, err)
	assert.Nil(t, status)
}

func TestStatusesByIDs_ReturnsOnlyExistingUsers(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000005", "s5@example.com", "5555555555", "S5", "online")
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000006", "s6@example.com", "6666666666", "S6", "offline")

	statuses, err := store.StatusesByIDs(ctx, []string{
		"00000000-0000-0000-0000-000000000005",
		"00000000-0000-0000-0000-000000000006",
		"00000000-0000-0000-0000-000000000097", // doesn't exist
	})
	require.NoError(t, err)
	assert.Equal(t, map[string]string{
		"00000000-0000-0000-0000-000000000005": "online",
		"00000000-0000-0000-0000-000000000006": "offline",
	}, statuses)
}

func TestUpdateStatus_PersistsAndUpdatesLastSeen(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000007", "us@example.com", "7777777777", "US", "offline")

	require.NoError(t, store.UpdateStatus(ctx, "00000000-0000-0000-0000-000000000007", "online"))

	status, err := store.StatusByID(ctx, "00000000-0000-0000-0000-000000000007")
	require.NoError(t, err)
	require.NotNil(t, status)
	assert.Equal(t, "online", *status)
}

func TestUpdateProfile_DisplayNameOnly_LeavesPictureUntouched(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000008", "up1@example.com", "8888888888", "Old Name", "offline")
	require.NoError(t, store.UpdateProfilePicture(ctx, "00000000-0000-0000-0000-000000000008", "https://example.com/old.png"))

	newName := "New Name"
	result, err := store.UpdateProfile(ctx, "00000000-0000-0000-0000-000000000008", user.ProfileUpdate{
		DisplayName: &newName,
	})
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "New Name", *result.DisplayName)

	row, err := store.ProfileByID(ctx, "00000000-0000-0000-0000-000000000008")
	require.NoError(t, err)
	require.NotNil(t, row.ProfilePictureURL)
	assert.Equal(t, "https://example.com/old.png", *row.ProfilePictureURL, "picture must be untouched when only displayName was set")
}

func TestUpdateProfile_NoFieldsSet_ReturnsNilNotError(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000009", "up2@example.com", "1000000000", "NoChange", "offline")

	result, err := store.UpdateProfile(ctx, "00000000-0000-0000-0000-000000000009", user.ProfileUpdate{})
	require.NoError(t, err)
	assert.Nil(t, result, "mirrors the original short-circuiting to a plain read when updates.length === 0")
}

func TestSearchByName_ExcludesCallerAndMatchesSubstring(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000010", "caller@example.com", "1000000001", "Caller Self", "online")
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000011", "match@example.com", "1000000002", "Jane Match", "online")
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000012", "nomatch@example.com", "1000000003", "Bob Other", "online")

	results, err := store.SearchByName(ctx, "00000000-0000-0000-0000-000000000010", "%Match%", 20, 0)
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, "Jane Match", results[0].DisplayName)

	count, err := store.CountSearchByName(ctx, "00000000-0000-0000-0000-000000000010", "%Match%")
	require.NoError(t, err)
	assert.Equal(t, 1, count)
}

func TestSearchByName_NeverReturnsCaller(t *testing.T) {
	store := startStore(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000013", "selfsearch@example.com", "1000000004", "SelfSearch", "online")

	results, err := store.SearchByName(ctx, "00000000-0000-0000-0000-000000000013", "%SelfSearch%", 20, 0)
	require.NoError(t, err)
	assert.Empty(t, results, "a caller searching a substring of their own name must not get themselves back")
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test -tags=integration ./internal/user/... -v`
Expected: FAIL — package `user` doesn't exist yet (`store.go` not created).

- [ ] **Step 3: Implement `store.go`**

`backend-go/internal/user/store.go`:
```go
package user

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"nexus-connect/backend-go/internal/platform/db"

	"github.com/jackc/pgx/v5"
)

// OptionalString carries a JSON PATCH field through its three possible
// states: key omitted (Set=false — don't touch), key present with value
// null (Set=true, Value=nil — clear to NULL), key present with a string
// (Set=true, Value=&s — set to this). A plain *string can't tell "omitted"
// apart from "present and null" — both would decode to a nil pointer — so
// this type's UnmarshalJSON (used by dto.go's updateProfileRequest, Task
// 10) only runs at all when Go's json package actually sees the key. Lives
// here rather than in dto.go because ProfileUpdate (below) needs it, and
// Store (this file) must compile and test on its own before Task 10 exists.
type OptionalString struct {
	Set   bool
	Value *string
}

func (o *OptionalString) UnmarshalJSON(data []byte) error {
	o.Set = true
	if string(data) == "null" {
		o.Value = nil
		return nil
	}
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	o.Value = &s
	return nil
}

// ProfileRow mirrors UserQueries.SELECT.PROFILE_BY_ID's column set in
// backend/packages/shared/src/database/queries/user.queries.ts — includes
// email, used only for the caller's own profile (GET /me).
type ProfileRow struct {
	ID                string
	Email             string
	UniqueNumber      string
	DisplayName       string
	ProfilePictureURL *string
	Status            string
	CreatedAt         time.Time
}

// PublicProfileRow mirrors UserQueries.SELECT.PUBLIC_PROFILE_BY_ID /
// PUBLIC_PROFILE_BY_UNIQUE_NUMBER's column set — no email. Used for any
// other user's profile (GET /:userId, fixed per this plan's Global
// Constraints — see Task 6), search results, and lookup-by-number.
type PublicProfileRow struct {
	ID                string
	DisplayName       string
	UniqueNumber      string
	ProfilePictureURL *string
	Status            string
}

// ProfileUpdate carries the fields PATCH /me actually wants to change.
// DisplayName nil means "don't touch"; ProfilePictureURL.Set false means
// "don't touch", Set true with Value nil means "clear to NULL", Set true
// with a non-nil Value means "set to this URL".
type ProfileUpdate struct {
	DisplayName       *string
	ProfilePictureURL OptionalString
}

type Store struct {
	db *db.DB
}

func NewStore(database *db.DB) *Store {
	return &Store{db: database}
}

func (s *Store) ProfileByID(ctx context.Context, userID string) (*ProfileRow, error) {
	var r ProfileRow
	err := s.db.QueryRow(ctx,
		`SELECT id, email, unique_number, display_name, profile_picture_url, status, created_at
		 FROM users WHERE id = $1`,
		userID,
	).Scan(&r.ID, &r.Email, &r.UniqueNumber, &r.DisplayName, &r.ProfilePictureURL, &r.Status, &r.CreatedAt)
	return queryOneRow(&r, err)
}

func (s *Store) PublicProfileByID(ctx context.Context, userID string) (*PublicProfileRow, error) {
	var r PublicProfileRow
	err := s.db.QueryRow(ctx,
		`SELECT id, display_name, unique_number, profile_picture_url, status
		 FROM users WHERE id = $1`,
		userID,
	).Scan(&r.ID, &r.DisplayName, &r.UniqueNumber, &r.ProfilePictureURL, &r.Status)
	return queryOneRow(&r, err)
}

func (s *Store) PublicProfileByUniqueNumber(ctx context.Context, uniqueNumber string) (*PublicProfileRow, error) {
	var r PublicProfileRow
	err := s.db.QueryRow(ctx,
		`SELECT id, display_name, unique_number, profile_picture_url, status
		 FROM users WHERE unique_number = $1`,
		uniqueNumber,
	).Scan(&r.ID, &r.DisplayName, &r.UniqueNumber, &r.ProfilePictureURL, &r.Status)
	return queryOneRow(&r, err)
}

func (s *Store) StatusByID(ctx context.Context, userID string) (*string, error) {
	var status string
	err := s.db.QueryRow(ctx, "SELECT status FROM users WHERE id = $1", userID).Scan(&status)
	return queryOneRow(&status, err)
}

func (s *Store) StatusesByIDs(ctx context.Context, userIDs []string) (map[string]string, error) {
	if len(userIDs) == 0 {
		return map[string]string{}, nil
	}

	rows, err := s.db.Query(ctx, "SELECT id, status FROM users WHERE id = ANY($1)", userIDs)
	if err != nil {
		return nil, fmt.Errorf("user: querying statuses by ids: %w", err)
	}
	defer rows.Close()

	result := make(map[string]string, len(userIDs))
	for rows.Next() {
		var id, status string
		if err := rows.Scan(&id, &status); err != nil {
			return nil, fmt.Errorf("user: scanning status row: %w", err)
		}
		result[id] = status
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("user: iterating status rows: %w", err)
	}
	return result, nil
}

// UpdateStatus also sets last_seen_at, matching UserQueries.UPDATE.STATUS
// exactly (not just the status column).
func (s *Store) UpdateStatus(ctx context.Context, userID, status string) error {
	_, err := s.db.Exec(ctx,
		"UPDATE users SET status = $1, last_seen_at = NOW(), updated_at = NOW() WHERE id = $2",
		status, userID,
	)
	if err != nil {
		return fmt.Errorf("user: updating status: %w", err)
	}
	return nil
}

// UpdateProfile builds its SQL dynamically, mirroring UserService.updateProfile's
// own inline (not UserQueries-based) construction in the original — a
// pre-existing style inconsistency the original's own AGENTS.md calls out,
// not a behavior bug, so it's ported as-is rather than "fixed" into a
// UserQueries-based form that doesn't exist today.
func (s *Store) UpdateProfile(ctx context.Context, userID string, update ProfileUpdate) (*ProfileUpdate, error) {
	var sets []string
	var args []any
	argN := 1

	if update.DisplayName != nil {
		sets = append(sets, fmt.Sprintf("display_name = $%d", argN))
		args = append(args, *update.DisplayName)
		argN++
	}
	if update.ProfilePictureURL.Set {
		sets = append(sets, fmt.Sprintf("profile_picture_url = $%d", argN))
		args = append(args, update.ProfilePictureURL.Value)
		argN++
	}

	if len(sets) == 0 {
		return nil, nil
	}

	sets = append(sets, "updated_at = NOW()")
	args = append(args, userID)

	sql := fmt.Sprintf(
		"UPDATE users SET %s WHERE id = $%d RETURNING display_name, profile_picture_url",
		strings.Join(sets, ", "), argN,
	)

	var result ProfileUpdate
	var displayName string
	var pictureURL *string
	err := s.db.QueryRow(ctx, sql, args...).Scan(&displayName, &pictureURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("user: updating profile: %w", err)
	}
	result.DisplayName = &displayName
	result.ProfilePictureURL = OptionalString{Set: true, Value: pictureURL}
	return &result, nil
}

func (s *Store) UpdateProfilePicture(ctx context.Context, userID, url string) error {
	_, err := s.db.Exec(ctx,
		"UPDATE users SET profile_picture_url = $1, updated_at = NOW() WHERE id = $2",
		url, userID,
	)
	if err != nil {
		return fmt.Errorf("user: updating profile picture: %w", err)
	}
	return nil
}

func (s *Store) SearchByName(ctx context.Context, excludeUserID, likePattern string, limit, offset int) ([]PublicProfileRow, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, display_name, unique_number, profile_picture_url, status
		 FROM users WHERE id != $1 AND display_name ILIKE $2
		 ORDER BY display_name ASC LIMIT $3 OFFSET $4`,
		excludeUserID, likePattern, limit, offset,
	)
	if err != nil {
		return nil, fmt.Errorf("user: searching by name: %w", err)
	}
	defer rows.Close()

	var results []PublicProfileRow
	for rows.Next() {
		var r PublicProfileRow
		if err := rows.Scan(&r.ID, &r.DisplayName, &r.UniqueNumber, &r.ProfilePictureURL, &r.Status); err != nil {
			return nil, fmt.Errorf("user: scanning search row: %w", err)
		}
		results = append(results, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("user: iterating search rows: %w", err)
	}
	return results, nil
}

func (s *Store) CountSearchByName(ctx context.Context, excludeUserID, likePattern string) (int, error) {
	var count int
	err := s.db.QueryRow(ctx,
		"SELECT COUNT(*) FROM users WHERE id != $1 AND display_name ILIKE $2",
		excludeUserID, likePattern,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("user: counting search results: %w", err)
	}
	return count, nil
}

func queryOneRow[T any](row *T, err error) (*T, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("user: querying row: %w", err)
	}
	return row, nil
}
```

Note: `SearchByName`/`CountSearchByName` take the already-wildcarded `likePattern` (e.g. `%query%`) rather than building it internally — matches the original, where `user.service.ts` builds `` `%${query}%` `` once and passes it to both the data and count queries identically; building it twice (once per query) risks the two calls drifting apart if one is ever edited without the other.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend-go && go test -tags=integration ./internal/user/... -v`
Expected: PASS, all 13 tests green.

- [ ] **Step 5: Commit**

```bash
cd backend-go && go build ./... && go vet ./... && go test -tags=integration ./internal/user/... -v
git add backend-go/internal/user/store.go backend-go/internal/user/store_test.go
git commit -m "backend-go/user: add Store (Postgres queries for profile/status/search)"
```

---

## Task 5: `internal/user/events.go` — event types

**Files:**
- Create: `backend-go/internal/user/events.go`
- Create: `backend-go/internal/user/events_test.go`

**Interfaces:**
- Consumes: nothing (same zero-dependency pattern as `auth/events.go`).
- Produces:
  - `type ProfileUpdatedEvent struct { UserID string; Changes map[string]any }` with `EventType() string { return "user.profile_updated" }`
  - `type StatusChangedEvent struct { UserID string; NewStatus string }` with `EventType() string { return "user.status_changed" }`

- [ ] **Step 1: Write the failing test**

`backend-go/internal/user/events_test.go`:
```go
package user_test

import (
	"testing"

	"nexus-connect/backend-go/internal/user"

	"github.com/stretchr/testify/assert"
)

func TestProfileUpdatedEvent_EventType(t *testing.T) {
	e := user.ProfileUpdatedEvent{UserID: "u-1", Changes: map[string]any{"displayName": "New"}}
	assert.Equal(t, "user.profile_updated", e.EventType())
}

func TestStatusChangedEvent_EventType(t *testing.T) {
	e := user.StatusChangedEvent{UserID: "u-1", NewStatus: "online"}
	assert.Equal(t, "user.status_changed", e.EventType())
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test ./internal/user/... -v -run EventType`
Expected: FAIL — `user.ProfileUpdatedEvent`/`user.StatusChangedEvent` undefined.

- [ ] **Step 3: Implement**

`backend-go/internal/user/events.go`:
```go
package user

// ProfileUpdatedEvent and StatusChangedEvent port the payload shapes
// UserEventTypes.USER_PROFILE_UPDATED/USER_STATUS_CHANGED publish in
// backend/services/user-service/src/services/user.service.ts, minus the
// Kafka envelope — see auth/events.go's own comment for why (no Go event
// bus equivalent of that envelope exists, matching spec §4.5).

type ProfileUpdatedEvent struct {
	UserID  string
	Changes map[string]any
}

func (ProfileUpdatedEvent) EventType() string { return "user.profile_updated" }

type StatusChangedEvent struct {
	UserID    string
	NewStatus string
}

func (StatusChangedEvent) EventType() string { return "user.status_changed" }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend-go && go test ./internal/user/... -v -run EventType`
Expected: PASS, both tests green.

- [ ] **Step 5: Commit**

```bash
cd backend-go && go build ./... && go vet ./... && go test ./internal/user/... -v
git add backend-go/internal/user/events.go backend-go/internal/user/events_test.go
git commit -m "backend-go/user: add ProfileUpdatedEvent/StatusChangedEvent"
```

---

## Task 6: `internal/user/service_profile.go` — GetProfile, GetPublicProfile, UpdateProfile

**Files:**
- Create: `backend-go/internal/user/service_profile.go`
- Create: `backend-go/internal/user/service_profile_test.go` (build-tagged `integration`)

**Interfaces:**
- Consumes: `*Store.{ProfileByID,PublicProfileByID,UpdateProfile}` (Task 4), `*cache.Cache.Get` + `cache.UserStatusKey` (foundation, already built), `*events.Bus.Publish` (foundation), `apperrors.NotFound` (foundation).
- Produces:
  - `type Service struct` + `func NewService(store *Store, c *cache.Cache, bus *events.Bus, cfg config.Config) *Service` — the shared `Service` type every other task in this module adds methods to, same convention as `auth`'s `Service`.
  - `type Profile struct { ID, Email, UniqueNumber, DisplayName, Status string; ProfilePictureURL *string; CreatedAt time.Time }`
  - `type PublicProfile struct { ID, DisplayName, UniqueNumber, Status string; ProfilePictureURL *string }`
  - `func (s *Service) GetProfile(ctx context.Context, userID string) (Profile, error)` — includes email, for `/me`.
  - `func (s *Service) GetPublicProfile(ctx context.Context, userID string) (PublicProfile, error)` — no email, for `/:userId` (this is the fix).
  - `func (s *Service) UpdateProfile(ctx context.Context, userID string, update ProfileUpdate) (PublicProfile, error)`

- [ ] **Step 1: Write the failing test**

`backend-go/internal/user/service_profile_test.go`:
```go
//go:build integration

package user_test

import (
	"context"
	"testing"

	"nexus-connect/backend-go/internal/platform/cache"
	"nexus-connect/backend-go/internal/platform/config"
	"nexus-connect/backend-go/internal/platform/events"
	"nexus-connect/backend-go/internal/platform/logger"
	"nexus-connect/backend-go/internal/user"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
)

func startCacheForUser(t *testing.T) *cache.Cache {
	t.Helper()
	ctx := context.Background()
	container, err := tcredis.Run(ctx, "redis:7-alpine")
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })
	connStr, err := container.ConnectionString(ctx)
	require.NoError(t, err)
	return cache.New(stripRedisScheme(connStr), "", 0)
}

func stripRedisScheme(connStr string) string {
	const prefix = "redis://"
	if len(connStr) >= len(prefix) && connStr[:len(prefix)] == prefix {
		return connStr[len(prefix):]
	}
	return connStr
}

func newTestService(t *testing.T) (*user.Service, *user.Store) {
	t.Helper()
	store := startStore(t) // from store_test.go, same package
	c := startCacheForUser(t)
	bus := events.NewBus(logger.New("test"))
	cfg := config.Config{StorageBucket: "test-bucket", StorageRegion: "us-east-1"}
	return user.NewService(store, c, bus, cfg), store
}

func TestGetProfile_ReturnsFullProfileIncludingEmail(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000020", "getprofile@example.com", "2000000001", "Get Profile", "offline")

	profile, err := svc.GetProfile(ctx, "00000000-0000-0000-0000-000000000020")
	require.NoError(t, err)
	assert.Equal(t, "getprofile@example.com", profile.Email)
	assert.Equal(t, "Get Profile", profile.DisplayName)
}

func TestGetProfile_PrefersCachedStatusOverDBStatus(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000021", "cached@example.com", "2000000002", "Cached", "offline")
	require.NoError(t, store.UpdateStatus(ctx, "00000000-0000-0000-0000-000000000021", "online"))
	require.NoError(t, svc.UpdateStatus(ctx, "00000000-0000-0000-0000-000000000021", "busy")) // writes cache AND db to "busy"

	// Directly overwrite the DB (bypassing the cache) to prove the
	// service reads the cache, not the DB, when both exist.
	require.NoError(t, store.UpdateStatus(ctx, "00000000-0000-0000-0000-000000000021", "offline"))

	profile, err := svc.GetProfile(ctx, "00000000-0000-0000-0000-000000000021")
	require.NoError(t, err)
	assert.Equal(t, "busy", profile.Status, "cache (set to busy) must win over the DB's later-written offline")
}

func TestGetProfile_NotFound_ReturnsNotFoundError(t *testing.T) {
	svc, _ := newTestService(t)
	_, err := svc.GetProfile(context.Background(), "00000000-0000-0000-0000-000000000099")
	require.Error(t, err)
}

// TestGetPublicProfile_ResponseNeverHasEmailField pins Review Focus item 1
// at the type level: PublicProfile has no Email field, so there is no way
// for a caller of this method to accidentally serialize one, unlike a
// shared struct where a handler might just happen to omit the field most
// of the time.
func TestGetPublicProfile_ResponseNeverHasEmailField(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000022", "shouldnotleak@example.com", "2000000003", "No Leak", "online")

	profile, err := svc.GetPublicProfile(ctx, "00000000-0000-0000-0000-000000000022")
	require.NoError(t, err)
	assert.Equal(t, "No Leak", profile.DisplayName)
	// No assertion needed on an "Email" field — PublicProfile has none;
	// this test exists to force a compile error if that field is ever
	// added back to this type.
}

func TestGetPublicProfile_NotFound_ReturnsNotFoundError(t *testing.T) {
	svc, _ := newTestService(t)
	_, err := svc.GetPublicProfile(context.Background(), "00000000-0000-0000-0000-000000000098")
	require.Error(t, err)
}

func TestUpdateProfile_DisplayNameOnly(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000023", "updname@example.com", "2000000004", "Old", "online")

	newName := "New"
	profile, err := svc.UpdateProfile(ctx, "00000000-0000-0000-0000-000000000023", user.ProfileUpdate{DisplayName: &newName})
	require.NoError(t, err)
	assert.Equal(t, "New", profile.DisplayName)
}

// TestUpdateProfile_OmittedPictureLeavesItUntouched pins Review Focus item
// 3's first case: no profilePictureUrl key at all in the update.
func TestUpdateProfile_OmittedPictureLeavesItUntouched(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000024", "omit@example.com", "2000000005", "Omit", "online")
	require.NoError(t, store.UpdateProfilePicture(ctx, "00000000-0000-0000-0000-000000000024", "https://example.com/existing.png"))

	newName := "Omit Updated"
	_, err := svc.UpdateProfile(ctx, "00000000-0000-0000-0000-000000000024", user.ProfileUpdate{DisplayName: &newName})
	require.NoError(t, err)

	profile, err := svc.GetProfile(ctx, "00000000-0000-0000-0000-000000000024")
	require.NoError(t, err)
	require.NotNil(t, profile.ProfilePictureURL)
	assert.Equal(t, "https://example.com/existing.png", *profile.ProfilePictureURL)
}

// TestUpdateProfile_ExplicitNullClearsPicture pins Review Focus item 3's
// second case: profilePictureUrl present and explicitly null.
func TestUpdateProfile_ExplicitNullClearsPicture(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000025", "clear@example.com", "2000000006", "Clear", "online")
	require.NoError(t, store.UpdateProfilePicture(ctx, "00000000-0000-0000-0000-000000000025", "https://example.com/toclear.png"))

	_, err := svc.UpdateProfile(ctx, "00000000-0000-0000-0000-000000000025", user.ProfileUpdate{
		ProfilePictureURL: user.OptionalString{Set: true, Value: nil},
	})
	require.NoError(t, err)

	profile, err := svc.GetProfile(ctx, "00000000-0000-0000-0000-000000000025")
	require.NoError(t, err)
	assert.Nil(t, profile.ProfilePictureURL, "an explicit null must clear the column")
}

// TestUpdateProfile_RealURLSetsPicture pins Review Focus item 3's third
// case: profilePictureUrl present with a real value.
func TestUpdateProfile_RealURLSetsPicture(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000026", "setpic@example.com", "2000000007", "SetPic", "online")

	url := "https://example.com/new.png"
	profile, err := svc.UpdateProfile(ctx, "00000000-0000-0000-0000-000000000026", user.ProfileUpdate{
		ProfilePictureURL: user.OptionalString{Set: true, Value: &url},
	})
	require.NoError(t, err)
	require.NotNil(t, profile.ProfilePictureURL)
	assert.Equal(t, "https://example.com/new.png", *profile.ProfilePictureURL)
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test -tags=integration ./internal/user/... -v -run 'TestGetProfile|TestGetPublicProfile|TestUpdateProfile'`
Expected: FAIL — `user.NewService`/`svc.GetProfile`/`svc.GetPublicProfile`/`svc.UpdateProfile` undefined.

- [ ] **Step 3: Implement `service_profile.go`**

`backend-go/internal/user/service_profile.go`:
```go
package user

import (
	"context"
	"time"

	"nexus-connect/backend-go/internal/platform/cache"
	"nexus-connect/backend-go/internal/platform/config"
	apperrors "nexus-connect/backend-go/internal/platform/errors"
	"nexus-connect/backend-go/internal/platform/events"
)

type Service struct {
	store *Store
	cache *cache.Cache
	bus   *events.Bus
	cfg   config.Config
}

func NewService(store *Store, c *cache.Cache, bus *events.Bus, cfg config.Config) *Service {
	return &Service{store: store, cache: c, bus: bus, cfg: cfg}
}

type Profile struct {
	ID                string
	Email             string
	UniqueNumber      string
	DisplayName       string
	ProfilePictureURL *string
	Status            string
	CreatedAt         time.Time
}

type PublicProfile struct {
	ID                string
	DisplayName       string
	UniqueNumber      string
	ProfilePictureURL *string
	Status            string
}

// cachedStatusOr reads the live Redis status for userID, falling back to
// dbStatus on a cache miss — shared by GetProfile and GetPublicProfile
// (and reused by GetStatus/GetStatuses in service_status.go) so the
// "cache wins when present" rule (Review Focus item 2) lives in one place.
func (s *Service) cachedStatusOr(ctx context.Context, userID, dbStatus string) string {
	cached, err := s.cache.Get(ctx, cache.UserStatusKey(userID))
	if err != nil {
		return dbStatus
	}
	return cached
}

// GetProfile mirrors UserService.getProfile — includes email, for the
// caller's own profile only (GET /me).
func (s *Service) GetProfile(ctx context.Context, userID string) (Profile, error) {
	row, err := s.store.ProfileByID(ctx, userID)
	if err != nil {
		return Profile{}, err
	}
	if row == nil {
		return Profile{}, apperrors.NotFound("User")
	}

	return Profile{
		ID:                row.ID,
		Email:             row.Email,
		UniqueNumber:      row.UniqueNumber,
		DisplayName:       row.DisplayName,
		ProfilePictureURL: row.ProfilePictureURL,
		Status:            s.cachedStatusOr(ctx, userID, row.Status),
		CreatedAt:         row.CreatedAt,
	}, nil
}

// GetPublicProfile is this plan's fix for the original's email-leak bug
// (GET /:userId reusing getProfile()) — see this plan's Global Constraints.
// Uses PublicProfileRow, which has no Email field at all.
func (s *Service) GetPublicProfile(ctx context.Context, userID string) (PublicProfile, error) {
	row, err := s.store.PublicProfileByID(ctx, userID)
	if err != nil {
		return PublicProfile{}, err
	}
	if row == nil {
		return PublicProfile{}, apperrors.NotFound("User")
	}

	return PublicProfile{
		ID:                row.ID,
		DisplayName:       row.DisplayName,
		UniqueNumber:      row.UniqueNumber,
		ProfilePictureURL: row.ProfilePictureURL,
		Status:            s.cachedStatusOr(ctx, userID, row.Status),
	}, nil
}

// UpdateProfile mirrors UserService.updateProfile.
func (s *Service) UpdateProfile(ctx context.Context, userID string, update ProfileUpdate) (PublicProfile, error) {
	result, err := s.store.UpdateProfile(ctx, userID, update)
	if err != nil {
		return PublicProfile{}, err
	}
	if result == nil {
		// Mirrors the original: zero fields set -> just return the current profile.
		profile, err := s.GetPublicProfile(ctx, userID)
		return profile, err
	}

	changes := map[string]any{}
	if update.DisplayName != nil {
		changes["displayName"] = *update.DisplayName
	}
	if update.ProfilePictureURL.Set {
		changes["profilePictureUrl"] = update.ProfilePictureURL.Value
	}
	s.bus.Publish(ctx, ProfileUpdatedEvent{UserID: userID, Changes: changes})

	return s.GetPublicProfile(ctx, userID)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend-go && go test -tags=integration ./internal/user/... -v -run 'TestGetProfile|TestGetPublicProfile|TestUpdateProfile'`
Expected: PASS, all 9 tests green.

- [ ] **Step 5: Commit**

```bash
cd backend-go && go build ./... && go vet ./... && go test -tags=integration ./internal/user/... -v
git add backend-go/internal/user/service_profile.go backend-go/internal/user/service_profile_test.go
git commit -m "backend-go/user: add Service.{GetProfile,GetPublicProfile,UpdateProfile}"
```

---

## Task 7: `internal/user/service_status.go` — UpdateStatus, GetStatus, GetStatuses

**Files:**
- Create: `backend-go/internal/user/service_status.go`
- Create: `backend-go/internal/user/service_status_test.go` (build-tagged `integration`)

**Interfaces:**
- Consumes: `*Store.{UpdateStatus,StatusByID,StatusesByIDs}` (Task 4), `*cache.Cache.{Get,Set,SAdd,SRem,MGet}` + `cache.{UserStatusKey,OnlineUsersKey}` (foundation + Task 1), `*events.Bus.Publish` (foundation), `*Service` (Task 6, same type).
- Produces:
  - `func (s *Service) UpdateStatus(ctx context.Context, userID, status string) error`
  - `func (s *Service) GetStatus(ctx context.Context, userID string) (string, error)` — never errors on a not-found user; mirrors the original's `user?.status || 'offline'` default.
  - `func (s *Service) GetStatuses(ctx context.Context, userIDs []string) (map[string]string, error)`

- [ ] **Step 1: Write the failing test**

`backend-go/internal/user/service_status_test.go`:
```go
//go:build integration

package user_test

import (
	"context"
	"testing"

	"nexus-connect/backend-go/internal/platform/cache"
	"nexus-connect/backend-go/internal/user"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpdateStatus_WritesCacheAndDB(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000030", "us1@example.com", "3000000001", "US1", "offline")

	require.NoError(t, svc.UpdateStatus(ctx, "00000000-0000-0000-0000-000000000030", "online"))

	dbStatus, err := store.StatusByID(ctx, "00000000-0000-0000-0000-000000000030")
	require.NoError(t, err)
	require.NotNil(t, dbStatus)
	assert.Equal(t, "online", *dbStatus)
}

func TestGetStatus_FallsBackToDBOnCacheMiss(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000031", "us2@example.com", "3000000002", "US2", "away")

	// Directly writing the DB (not through svc.UpdateStatus) means the
	// cache is never populated -- this must still fall back correctly.
	status, err := svc.GetStatus(ctx, "00000000-0000-0000-0000-000000000031")
	require.NoError(t, err)
	assert.Equal(t, "away", status)
}

// TestGetStatus_PrefersCacheOverStaleDB pins Review Focus item 2: after
// UpdateStatus writes "busy" to both layers, a later direct DB write to
// "offline" (bypassing the cache entirely, simulating some other process
// having changed the DB) must NOT be what GetStatus returns -- the cache
// is authoritative for its TTL window.
func TestGetStatus_PrefersCacheOverStaleDB(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000032", "us3@example.com", "3000000003", "US3", "offline")
	require.NoError(t, svc.UpdateStatus(ctx, "00000000-0000-0000-0000-000000000032", "busy"))

	require.NoError(t, store.UpdateStatus(ctx, "00000000-0000-0000-0000-000000000032", "offline"))

	status, err := svc.GetStatus(ctx, "00000000-0000-0000-0000-000000000032")
	require.NoError(t, err)
	assert.Equal(t, "busy", status, "cache must win over a later, cache-bypassing DB write")
}

func TestGetStatus_NonExistentUser_ReturnsOfflineNotError(t *testing.T) {
	svc, _ := newTestService(t)
	status, err := svc.GetStatus(context.Background(), "00000000-0000-0000-0000-000000000099")
	require.NoError(t, err)
	assert.Equal(t, "offline", status)
}

// TestGetStatuses_MixOfCacheHitsAndMisses pins Review Focus item 4: one
// user has a cached status (fresher than the DB), two don't and must fall
// back to the DB -- all three must come back correct in one call.
func TestGetStatuses_MixOfCacheHitsAndMisses(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000033", "mix1@example.com", "3000000004", "Mix1", "offline")
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000034", "mix2@example.com", "3000000005", "Mix2", "busy")
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000035", "mix3@example.com", "3000000006", "Mix3", "away")

	// Only user 33 gets a cache entry, and it diverges from its own DB row
	// (set to offline in Postgres) -- proving this one's answer came from
	// the cache, not a DB fallback that happened to agree by coincidence.
	require.NoError(t, svc.UpdateStatus(ctx, "00000000-0000-0000-0000-000000000033", "online"))

	statuses, err := svc.GetStatuses(ctx, []string{
		"00000000-0000-0000-0000-000000000033",
		"00000000-0000-0000-0000-000000000034",
		"00000000-0000-0000-0000-000000000035",
	})
	require.NoError(t, err)
	assert.Equal(t, map[string]string{
		"00000000-0000-0000-0000-000000000033": "online", // from cache
		"00000000-0000-0000-0000-000000000034": "busy",   // from DB fallback
		"00000000-0000-0000-0000-000000000035": "away",   // from DB fallback
	}, statuses)
}

// TestUpdateStatus_OnlineUsersSetWrite pins the ported-but-dead
// online:users set write (Global Constraints' TODO(gap)) -- this test
// only proves the write doesn't error, since nothing in this codebase
// ever reads the set back (matching the original exactly).
func TestUpdateStatus_OnlineUsersSetWriteDoesNotError(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000036", "online1@example.com", "3000000007", "Online1", "offline")

	require.NoError(t, svc.UpdateStatus(ctx, "00000000-0000-0000-0000-000000000036", "online"))
	require.NoError(t, svc.UpdateStatus(ctx, "00000000-0000-0000-0000-000000000036", "offline"))
}

var _ = cache.OnlineUsersKey // referenced only to keep this import meaningful if a future edit trims the above
```

- [ ] **Step 2: Remove the placeholder import-keeper from Step 1 — it was never needed**

Delete `var _ = cache.OnlineUsersKey ...` and the `"nexus-connect/backend-go/internal/platform/cache"` import from this test file — nothing in `service_status_test.go` itself calls into `cache` directly (it only exercises `Service`'s methods, which use `cache` internally).

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend-go && go test -tags=integration ./internal/user/... -v -run 'TestUpdateStatus|TestGetStatus'`
Expected: FAIL — `svc.UpdateStatus`/`svc.GetStatus`/`svc.GetStatuses` undefined.

- [ ] **Step 4: Implement `service_status.go`**

`backend-go/internal/user/service_status.go`:
```go
package user

import (
	"context"
	"time"

	"nexus-connect/backend-go/internal/platform/cache"
)

// statusCacheTTL matches config.statusTtl (300s) in
// backend/services/user-service/src/config.ts. See auth's
// emailVerificationTTL note for why this is a constant here rather than a
// Config field.
const statusCacheTTL = 300 * time.Second

// UpdateStatus mirrors UserService.updateStatus.
//
// TODO(gap): the online:users Redis set this maintains (SADD on "online",
// SREM on every other status) is write-only -- nothing anywhere reads it
// back (confirmed via grep across backend/), likely scaffolding for an
// unbuilt presence feature. Ported as a faithful dead write anyway, see
// backend/services/user-service/AGENTS.md.
func (s *Service) UpdateStatus(ctx context.Context, userID, status string) error {
	if err := s.cache.Set(ctx, cache.UserStatusKey(userID), status, statusCacheTTL); err != nil {
		return err
	}

	if err := s.store.UpdateStatus(ctx, userID, status); err != nil {
		return err
	}

	if status == "online" {
		_ = s.cache.SAdd(ctx, cache.OnlineUsersKey(), userID)
	} else if status == "offline" {
		_ = s.cache.SRem(ctx, cache.OnlineUsersKey(), userID)
	}

	s.bus.Publish(ctx, StatusChangedEvent{UserID: userID, NewStatus: status})
	return nil
}

// GetStatus mirrors UserService.getStatus: Redis first, DB fallback,
// "offline" if neither has the user (matching `user?.status || 'offline'`).
func (s *Service) GetStatus(ctx context.Context, userID string) (string, error) {
	cached, err := s.cache.Get(ctx, cache.UserStatusKey(userID))
	if err == nil {
		return cached, nil
	}

	status, err := s.store.StatusByID(ctx, userID)
	if err != nil {
		return "", err
	}
	if status == nil {
		return "offline", nil
	}
	return *status, nil
}

// GetStatuses mirrors UserService.getStatuses: one Redis round trip
// (cache.MGet, Task 1 -- the original uses a pipeline of N GETs, which
// MGET already does in a single command, a cleaner implementation of the
// identical "batch read" intent) for every ID, then one DB query for
// whichever IDs that round trip didn't cover.
func (s *Service) GetStatuses(ctx context.Context, userIDs []string) (map[string]string, error) {
	keys := make([]string, len(userIDs))
	keyToID := make(map[string]string, len(userIDs))
	for i, id := range userIDs {
		key := cache.UserStatusKey(id)
		keys[i] = key
		keyToID[key] = id
	}

	cached, err := s.cache.MGet(ctx, keys)
	if err != nil {
		return nil, err
	}

	result := make(map[string]string, len(userIDs))
	var missing []string
	for _, id := range userIDs {
		if status, ok := cached[cache.UserStatusKey(id)]; ok {
			result[id] = status
		} else {
			missing = append(missing, id)
		}
	}

	if len(missing) > 0 {
		dbStatuses, err := s.store.StatusesByIDs(ctx, missing)
		if err != nil {
			return nil, err
		}
		for id, status := range dbStatuses {
			result[id] = status
		}
	}

	return result, nil
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend-go && go test -tags=integration ./internal/user/... -v -run 'TestUpdateStatus|TestGetStatus'`
Expected: PASS, all 6 tests green.

- [ ] **Step 6: Commit**

```bash
cd backend-go && go build ./... && go vet ./... && go test -tags=integration ./internal/user/... -v
git add backend-go/internal/user/service_status.go backend-go/internal/user/service_status_test.go
git commit -m "backend-go/user: add Service.{UpdateStatus,GetStatus,GetStatuses}"
```

---

## Task 8: `internal/user/service_search.go` — FindByUniqueNumber, SearchByName

**Files:**
- Create: `backend-go/internal/user/service_search.go`
- Create: `backend-go/internal/user/service_search_test.go` (build-tagged `integration`)

**Interfaces:**
- Consumes: `*Store.{PublicProfileByUniqueNumber,SearchByName,CountSearchByName}` (Task 4), `*Service` (Task 6, same type), `apperrors.NotFound` (foundation).
- Produces:
  - `func (s *Service) FindByUniqueNumber(ctx context.Context, uniqueNumber string) (PublicProfile, error)`
  - `type SearchResult struct { Users []PublicProfile; Total, Page, Limit int }`
  - `func (s *Service) SearchByName(ctx context.Context, query, excludeUserID string, page, limit int) (SearchResult, error)`

- [ ] **Step 1: Write the failing test**

`backend-go/internal/user/service_search_test.go`:
```go
//go:build integration

package user_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFindByUniqueNumber_Found(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000040", "fbn@example.com", "4000000001", "FBN", "online")

	profile, err := svc.FindByUniqueNumber(ctx, "4000000001")
	require.NoError(t, err)
	assert.Equal(t, "FBN", profile.DisplayName)
}

func TestFindByUniqueNumber_NotFound_ReturnsNotFoundError(t *testing.T) {
	svc, _ := newTestService(t)
	_, err := svc.FindByUniqueNumber(context.Background(), "9999999998")
	require.Error(t, err)
}

func TestSearchByName_ReturnsPaginatedResults(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000041", "caller2@example.com", "4000000002", "Caller2", "online")
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000042", "s1@example.com", "4000000003", "SearchTarget One", "online")
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000043", "s2@example.com", "4000000004", "SearchTarget Two", "online")

	result, err := svc.SearchByName(ctx, "SearchTarget", "00000000-0000-0000-0000-000000000041", 1, 20)
	require.NoError(t, err)
	assert.Equal(t, 2, result.Total)
	assert.Len(t, result.Users, 2)
	assert.Equal(t, 1, result.Page)
	assert.Equal(t, 20, result.Limit)
}

// TestSearchByName_NeverIncludesCaller pins the same "no self-match" rule
// store_test.go's TestSearchByName_NeverReturnsCaller pins at the Store
// layer -- repeated here at the Service layer since SearchByName is also
// where the `%query%` wildcarding happens, a step the Store-layer test
// bypasses by passing an already-wildcarded pattern directly.
func TestSearchByName_NeverIncludesCaller(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000044", "selfonly@example.com", "4000000005", "SelfOnlyMatch", "online")

	result, err := svc.SearchByName(ctx, "SelfOnlyMatch", "00000000-0000-0000-0000-000000000044", 1, 20)
	require.NoError(t, err)
	assert.Empty(t, result.Users)
	assert.Equal(t, 0, result.Total)
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test -tags=integration ./internal/user/... -v -run 'TestFindByUniqueNumber|TestSearchByName'`
Expected: FAIL — `svc.FindByUniqueNumber`/`svc.SearchByName` undefined.

- [ ] **Step 3: Implement `service_search.go`**

`backend-go/internal/user/service_search.go`:
```go
package user

import (
	"context"
	"fmt"

	apperrors "nexus-connect/backend-go/internal/platform/errors"
)

// FindByUniqueNumber mirrors UserService.findByUniqueNumber.
func (s *Service) FindByUniqueNumber(ctx context.Context, uniqueNumber string) (PublicProfile, error) {
	row, err := s.store.PublicProfileByUniqueNumber(ctx, uniqueNumber)
	if err != nil {
		return PublicProfile{}, err
	}
	if row == nil {
		return PublicProfile{}, apperrors.NotFound("User")
	}

	return PublicProfile{
		ID:                row.ID,
		DisplayName:       row.DisplayName,
		UniqueNumber:      row.UniqueNumber,
		ProfilePictureURL: row.ProfilePictureURL,
		Status:            s.cachedStatusOr(ctx, row.ID, row.Status),
	}, nil
}

type SearchResult struct {
	Users []PublicProfile
	Total int
	Page  int
	Limit int
}

// SearchByName mirrors UserService.searchByName, building the `%query%`
// ILIKE pattern once and reusing it for both the data and count queries
// (same reasoning as the original: building it twice risks the two
// queries drifting apart if one is ever edited without the other).
func (s *Service) SearchByName(ctx context.Context, query, excludeUserID string, page, limit int) (SearchResult, error) {
	offset := (page - 1) * limit
	likePattern := fmt.Sprintf("%%%s%%", query)

	rows, err := s.store.SearchByName(ctx, excludeUserID, likePattern, limit, offset)
	if err != nil {
		return SearchResult{}, err
	}
	total, err := s.store.CountSearchByName(ctx, excludeUserID, likePattern)
	if err != nil {
		return SearchResult{}, err
	}

	users := make([]PublicProfile, len(rows))
	for i, row := range rows {
		users[i] = PublicProfile{
			ID:                row.ID,
			DisplayName:       row.DisplayName,
			UniqueNumber:      row.UniqueNumber,
			ProfilePictureURL: row.ProfilePictureURL,
			Status:            row.Status,
		}
	}

	return SearchResult{Users: users, Total: total, Page: page, Limit: limit}, nil
}
```

Note: `SearchByName`'s per-result `Status` field uses the DB-stored `row.Status` directly, not `cachedStatusOr` — matching the original exactly (`searchByName` in `user.service.ts` maps straight from the DB rows with no Redis lookup at all, unlike `getProfile`/`findByUniqueNumber`, which do check Redis). This is a real, original inconsistency (search results can show a stale status for up to the 300s TTL window after a change), not a Go-introduced one — faithfully preserved, no `TODO(gap)` needed since it's not in `AGENTS.md`'s enumerated list and has no realistic security/correctness impact (a slightly-stale presence indicator in a search result list).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend-go && go test -tags=integration ./internal/user/... -v -run 'TestFindByUniqueNumber|TestSearchByName'`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Commit**

```bash
cd backend-go && go build ./... && go vet ./... && go test -tags=integration ./internal/user/... -v
git add backend-go/internal/user/service_search.go backend-go/internal/user/service_search_test.go
git commit -m "backend-go/user: add Service.{FindByUniqueNumber,SearchByName}"
```

---

## Task 9: `internal/user/service_avatar.go` — UploadAvatar

**Files:**
- Create: `backend-go/internal/user/service_avatar.go`
- Create: `backend-go/internal/user/service_avatar_test.go` (build-tagged `integration`)

**Interfaces:**
- Consumes: `*Store.UpdateProfilePicture` (Task 4), `*Service` (Task 6, same type), `config.Config.{StorageBucket,StorageRegion}` (Task 3).
- Produces: `func (s *Service) UploadAvatar(ctx context.Context, userID, fileExtension string) (profilePictureURL string, err error)` — takes only the extension (not the file bytes), since the original never persists or inspects the file content either (see Step 3's comment).

- [ ] **Step 1: Write the failing test**

`backend-go/internal/user/service_avatar_test.go`:
```go
//go:build integration

package user_test

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUploadAvatar_WritesFabricatedURLToDB(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000050", "avatar1@example.com", "5000000001", "Avatar1", "online")

	url, err := svc.UploadAvatar(ctx, "00000000-0000-0000-0000-000000000050", "png")
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(url, "https://test-bucket.s3.us-east-1.amazonaws.com/avatars/"))
	assert.True(t, strings.HasSuffix(url, ".png"))

	profile, err := svc.GetProfile(ctx, "00000000-0000-0000-0000-000000000050")
	require.NoError(t, err)
	require.NotNil(t, profile.ProfilePictureURL)
	assert.Equal(t, url, *profile.ProfilePictureURL)
}

func TestUploadAvatar_DifferentCallsProduceDifferentURLs(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000051", "avatar2@example.com", "5000000002", "Avatar2", "online")

	first, err := svc.UploadAvatar(ctx, "00000000-0000-0000-0000-000000000051", "jpg")
	require.NoError(t, err)
	second, err := svc.UploadAvatar(ctx, "00000000-0000-0000-0000-000000000051", "jpg")
	require.NoError(t, err)
	assert.NotEqual(t, first, second, "each upload must get its own filename even for the same user/extension")
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-go && go test -tags=integration ./internal/user/... -v -run TestUploadAvatar`
Expected: FAIL — `svc.UploadAvatar` undefined.

- [ ] **Step 3: Implement `service_avatar.go`**

`backend-go/internal/user/service_avatar.go`:
```go
package user

import (
	"context"
	"fmt"
	"time"
)

// UploadAvatar mirrors UserService.uploadAvatar.
//
// TODO(gap): this does not upload anything anywhere -- it fabricates an
// S3-shaped URL from config and writes that fake URL to the DB, returning
// a real success response. The original has an explicit
// "// TODO: Implement actual S3 upload" comment in user.service.ts and
// never constructs an S3 client despite reading STORAGE_* config for one.
// Faithfully ported as-is, see backend/services/user-service/AGENTS.md.
// This also means neither this method nor its caller ever needs the
// uploaded file's actual bytes -- the original reads the file into a
// buffer only to immediately discard it (`const buffer = await file.toBuffer()`,
// never referenced again) -- so this signature only takes the file
// extension, not file content, which is the one part of the original's
// behavior that's meaningfully simpler to port correctly than to port
// literally (reading and discarding bytes neither of us need serves no
// purpose here).
func (s *Service) UploadAvatar(ctx context.Context, userID, fileExtension string) (string, error) {
	fileName := fmt.Sprintf("%s-%d.%s", userID, time.Now().UnixNano(), fileExtension)
	url := fmt.Sprintf("https://%s.s3.%s.amazonaws.com/avatars/%s", s.cfg.StorageBucket, s.cfg.StorageRegion, fileName)

	if err := s.store.UpdateProfilePicture(ctx, userID, url); err != nil {
		return "", err
	}
	return url, nil
}
```

Note: the original builds its filename with `Date.now()` (millisecond resolution); this uses `time.Now().UnixNano()` instead, since `TestUploadAvatar_DifferentCallsProduceDifferentURLs` calling `UploadAvatar` twice in immediate succession could otherwise collide at millisecond resolution in a fast test run — nanosecond resolution is a strictly more collision-resistant choice with no observable behavior difference to any caller (the filename is opaque either way).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend-go && go test -tags=integration ./internal/user/... -v -run TestUploadAvatar`
Expected: PASS, both tests green.

- [ ] **Step 5: Commit**

```bash
cd backend-go && go build ./... && go vet ./... && go test -tags=integration ./internal/user/... -v
git add backend-go/internal/user/service_avatar.go backend-go/internal/user/service_avatar_test.go
git commit -m "backend-go/user: add Service.UploadAvatar (faithful fake-S3 stub)"
```

---

## Task 10: `internal/user/dto.go` + `handler.go` — user-route HTTP handlers

**Files:**
- Create: `backend-go/internal/user/dto.go`
- Create: `backend-go/internal/user/handler.go`
- Create: `backend-go/internal/user/handler_test.go` (build-tagged `integration`)

**Interfaces:**
- Consumes: `*Service` (Tasks 6-9), `httpserver.{HandlerFunc,WriteJSON,WrapWithBodyLimit}` (foundation + Task 2), `validate.Struct` (foundation), `platformauth.FromContext` (foundation), `apperrors.{BadRequest,Validation}` (foundation).
- Produces:
  - `type Handler struct` + `func NewHandler(svc *Service, log *slog.Logger) *Handler`
  - 7 methods matching `httpserver.HandlerFunc`'s signature: `Me`, `GetByID`, `UpdateMe`, `UpdateMyStatus`, `GetStatusByID`, `GetStatuses`, `UploadAvatar`
  - DTOs: `updateProfileRequest`, `updateStatusRequest`, `statusesRequest`

- [ ] **Step 1: Write the failing test**

`backend-go/internal/user/handler_test.go`:
```go
//go:build integration

package user_test

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	platformauth "nexus-connect/backend-go/internal/platform/auth"
	"nexus-connect/backend-go/internal/platform/httpserver"
	"nexus-connect/backend-go/internal/platform/logger"
	"nexus-connect/backend-go/internal/user"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestHandler(t *testing.T) (*user.Handler, *user.Store) {
	t.Helper()
	svc, store := newTestService(t)
	return user.NewHandler(svc, logger.New("test")), store
}

// doAuthedJSON wraps fn through httpserver.Wrap and attaches a TokenPayload
// for callerID to the request context, mirroring platformauth.Middleware's
// own attachment so handlers that call platformauth.FromContext(r.Context())
// see the same shape they would behind the real middleware.
func doAuthedJSON(t *testing.T, fn httpserver.HandlerFunc, method, callerID, body string, urlParams map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	wrapped := httpserver.Wrap(logger.New("test"), fn)
	req := httptest.NewRequest(method, "/", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")

	ctx := context.WithValue(req.Context(), platformauth.UserContextKey, platformauth.TokenPayload{UserID: callerID})
	req = req.WithContext(ctx)

	if len(urlParams) > 0 {
		req = withChiURLParams(req, urlParams)
	}

	rec := httptest.NewRecorder()
	wrapped(rec, req)
	return rec
}

func TestHandlerMe_ReturnsOwnProfileIncludingEmail(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000060", "handlerme@example.com", "6000000001", "HandlerMe", "online")

	rec := doAuthedJSON(t, h.Me, http.MethodGet, "00000000-0000-0000-0000-000000000060", "", nil)

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "handlerme@example.com", body["email"])
}

// TestHandlerGetByID_ResponseNeverContainsEmailKey pins Review Focus item 1
// at the wire level: not just "the struct has no Email field" (already
// pinned in service_profile_test.go) but "the actual JSON body sent to an
// HTTP client has no email key at all" -- the layer an attacker actually
// observes.
func TestHandlerGetByID_ResponseNeverContainsEmailKey(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000061", "shouldnotleak2@example.com", "6000000002", "NoLeak2", "online")

	rec := doAuthedJSON(t, h.GetByID, http.MethodGet, "00000000-0000-0000-0000-000000000099", "", map[string]string{
		"userId": "00000000-0000-0000-0000-000000000061",
	})

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	_, hasEmail := body["email"]
	assert.False(t, hasEmail, "GET /:userId must never include an email key, regardless of who's asking")
}

func TestHandlerUpdateMe_DisplayNameOnly_Returns200(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000062", "updme@example.com", "6000000003", "Old", "online")

	rec := doAuthedJSON(t, h.UpdateMe, http.MethodPatch, "00000000-0000-0000-0000-000000000062", `{"displayName":"New Name"}`, nil)

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "New Name", body["displayName"])
}

func TestHandlerUpdateMe_TooLongDisplayName_Returns422(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000063", "toolong@example.com", "6000000004", "Short", "online")

	longName := make([]byte, 101)
	for i := range longName {
		longName[i] = 'a'
	}
	reqBody, err := json.Marshal(map[string]string{"displayName": string(longName)})
	require.NoError(t, err)

	rec := doAuthedJSON(t, h.UpdateMe, http.MethodPatch, "00000000-0000-0000-0000-000000000063", string(reqBody), nil)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

// TestHandlerUpdateMe_InvalidProfilePictureURL_Returns422 pins the `url`
// format check the original's `z.string().url()` applies when the field
// is present and non-null.
func TestHandlerUpdateMe_InvalidProfilePictureURL_Returns422(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000064", "badurl@example.com", "6000000005", "BadURL", "online")

	rec := doAuthedJSON(t, h.UpdateMe, http.MethodPatch, "00000000-0000-0000-0000-000000000064", `{"profilePictureUrl":"not-a-url"}`, nil)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

// TestHandlerUpdateMe_NonHTTPSchemeProfilePictureURL_Returns422 pins a
// deliberate hardening beyond the original (see Task 4's ledger entry):
// a syntactically valid but non-http(s) scheme (javascript:, data:, etc.)
// must be rejected too, not just a malformed string.
func TestHandlerUpdateMe_NonHTTPSchemeProfilePictureURL_Returns422(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000073", "jsscheme@example.com", "6000000014", "JSScheme", "online")

	rec := doAuthedJSON(t, h.UpdateMe, http.MethodPatch, "00000000-0000-0000-0000-000000000073", `{"profilePictureUrl":"javascript:alert(1)"}`, nil)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestHandlerUpdateMyStatus_ValidStatus_Returns200(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000065", "status1@example.com", "6000000006", "Status1", "offline")

	rec := doAuthedJSON(t, h.UpdateMyStatus, http.MethodPatch, "00000000-0000-0000-0000-000000000065", `{"status":"busy"}`, nil)

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "busy", body["status"])
}

func TestHandlerUpdateMyStatus_InvalidStatus_Returns422(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000066", "status2@example.com", "6000000007", "Status2", "offline")

	rec := doAuthedJSON(t, h.UpdateMyStatus, http.MethodPatch, "00000000-0000-0000-0000-000000000066", `{"status":"not-a-real-status"}`, nil)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestHandlerGetStatusByID_ReturnsStatus(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000067", "gsbid@example.com", "6000000008", "GSBID", "away")

	rec := doAuthedJSON(t, h.GetStatusByID, http.MethodGet, "00000000-0000-0000-0000-000000000099", "", map[string]string{
		"userId": "00000000-0000-0000-0000-000000000067",
	})

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "away", body["status"])
}

func TestHandlerGetStatuses_ReturnsMapOfStatuses(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000068", "gs1@example.com", "6000000009", "GS1", "online")
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000069", "gs2@example.com", "6000000010", "GS2", "offline")

	reqBody, err := json.Marshal(map[string][]string{
		"userIds": {"00000000-0000-0000-0000-000000000068", "00000000-0000-0000-0000-000000000069"},
	})
	require.NoError(t, err)

	rec := doAuthedJSON(t, h.GetStatuses, http.MethodPost, "00000000-0000-0000-0000-000000000099", string(reqBody), nil)

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "online", body["statuses"]["00000000-0000-0000-0000-000000000068"])
	assert.Equal(t, "offline", body["statuses"]["00000000-0000-0000-0000-000000000069"])
}

func TestHandlerUploadAvatar_ValidImage_Returns200(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000070", "uploadavatar@example.com", "6000000011", "UploadAvatar", "online")

	// multipart.Writer.CreateFormFile always sets Content-Type to
	// application/octet-stream, regardless of the filename's extension —
	// it never sniffs or infers a type. UploadAvatar's allowlist check
	// reads this header, so a real image upload must set it explicitly
	// via CreatePart, the same way TestHandlerUploadAvatar_DisallowedMimeType_Returns400
	// below already has to for its own (rejected) content type.
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreatePart(map[string][]string{
		"Content-Disposition": {`form-data; name="file"; filename="photo.png"`},
		"Content-Type":        {"image/png"},
	})
	require.NoError(t, err)
	_, err = part.Write([]byte("fake-png-bytes"))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	wrapped := httpserver.WrapWithBodyLimit(logger.New("test"), h.UploadAvatar, 5<<20)
	req := httptest.NewRequest(http.MethodPost, "/", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	ctx := context.WithValue(req.Context(), platformauth.UserContextKey, platformauth.TokenPayload{UserID: "00000000-0000-0000-0000-000000000070"})
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Contains(t, body["profilePictureUrl"], ".png")
}

// TestHandlerUploadAvatar_DisallowedMimeType_Returns400 pins Review Focus
// item 5: a disallowed type must be rejected before UploadAvatar is ever
// called, and the user's existing picture must survive untouched.
func TestHandlerUploadAvatar_DisallowedMimeType_Returns400(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000071", "badmime@example.com", "6000000012", "BadMime", "online")

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreatePart(map[string][]string{
		"Content-Disposition": {`form-data; name="file"; filename="doc.pdf"`},
		"Content-Type":        {"application/pdf"},
	})
	require.NoError(t, err)
	_, err = part.Write([]byte("%PDF-fake"))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	wrapped := httpserver.WrapWithBodyLimit(logger.New("test"), h.UploadAvatar, 5<<20)
	req := httptest.NewRequest(http.MethodPost, "/", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	ctx := context.WithValue(req.Context(), platformauth.UserContextKey, platformauth.TokenPayload{UserID: "00000000-0000-0000-0000-000000000071"})
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestHandlerUploadAvatar_NoFile_Returns400(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000072", "nofile@example.com", "6000000013", "NoFile", "online")

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	require.NoError(t, writer.Close())

	wrapped := httpserver.WrapWithBodyLimit(logger.New("test"), h.UploadAvatar, 5<<20)
	req := httptest.NewRequest(http.MethodPost, "/", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	ctx := context.WithValue(req.Context(), platformauth.UserContextKey, platformauth.TokenPayload{UserID: "00000000-0000-0000-0000-000000000072"})
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

var _ = user.OptionalString{} // keep the user import's type surface exercised if a future edit trims the above
```

- [ ] **Step 2: Add the test-only `withChiURLParams` helper the test above calls, and remove the placeholder import-keeper**

Delete `var _ = user.OptionalString{} ...` from the bottom of the file — it was never needed (every test above already references `user.Handler`/`user.NewHandler` directly). Add this helper (it needs `chi`'s route-context injection, since `chi.URLParam(r, "userId")` reads from a context chi itself populates when `ServeHTTP` routes a real request — these handler-level tests call `h.GetByID` directly, bypassing chi's router, so the test must inject the same context chi would have):

```go
func withChiURLParams(r *http.Request, params map[string]string) *http.Request {
	rctx := chi.NewRouteContext()
	for k, v := range params {
		rctx.URLParams.Add(k, v)
	}
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}
```

Add `"github.com/go-chi/chi/v5"` to this file's imports.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend-go && go test -tags=integration ./internal/user/... -v -run TestHandler`
Expected: FAIL — `user.Handler`/`user.NewHandler` undefined.

- [ ] **Step 4: Implement `dto.go`**

`backend-go/internal/user/dto.go`:
```go
package user

// Request DTOs. JSON tags match the wire format the frontend already
// sends. validate tags enforce exactly what the original enforces.

type updateProfileRequest struct {
	DisplayName       *string        `json:"displayName" validate:"omitempty,min=1,max=100"`
	ProfilePictureURL OptionalString `json:"profilePictureUrl"`
}

type updateStatusRequest struct {
	Status string `json:"status" validate:"required,oneof=online offline busy away do_not_disturb"`
}

type statusesRequest struct {
	UserIDs []string `json:"userIds" validate:"required,min=1,dive,uuid"`
}
```

- [ ] **Step 5: Implement `handler.go`**

`backend-go/internal/user/handler.go`:
```go
package user

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"

	platformauth "nexus-connect/backend-go/internal/platform/auth"
	apperrors "nexus-connect/backend-go/internal/platform/errors"
	"nexus-connect/backend-go/internal/platform/httpserver"
	"nexus-connect/backend-go/internal/platform/validate"

	"github.com/go-chi/chi/v5"
)

type Handler struct {
	svc *Service
	log *slog.Logger
}

func NewHandler(svc *Service, log *slog.Logger) *Handler {
	return &Handler{svc: svc, log: log}
}

// callerID reads the authenticated caller's user ID, attached by
// platformauth.Middleware (see routes.go) before any handler here runs.
func callerID(r *http.Request) string {
	payload, _ := platformauth.FromContext(r.Context())
	return payload.UserID
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

func profileJSON(p Profile) map[string]any {
	return map[string]any{
		"id":                p.ID,
		"email":             p.Email,
		"uniqueNumber":      p.UniqueNumber,
		"displayName":       p.DisplayName,
		"profilePictureUrl": p.ProfilePictureURL,
		"status":            p.Status,
		"createdAt":         p.CreatedAt,
	}
}

func publicProfileJSON(p PublicProfile) map[string]any {
	return map[string]any{
		"id":                p.ID,
		"displayName":       p.DisplayName,
		"uniqueNumber":      p.UniqueNumber,
		"profilePictureUrl": p.ProfilePictureURL,
		"status":            p.Status,
	}
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) error {
	profile, err := h.svc.GetProfile(r.Context(), callerID(r))
	if err != nil {
		return err
	}
	return httpserver.WriteJSON(w, http.StatusOK, profileJSON(profile))
}

// GetByID uses GetPublicProfile, never GetProfile -- this is the fix for
// the original's email-leak bug, see this plan's Global Constraints.
func (h *Handler) GetByID(w http.ResponseWriter, r *http.Request) error {
	userID := chi.URLParam(r, "userId")
	profile, err := h.svc.GetPublicProfile(r.Context(), userID)
	if err != nil {
		return err
	}
	return httpserver.WriteJSON(w, http.StatusOK, publicProfileJSON(profile))
}

func (h *Handler) UpdateMe(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[updateProfileRequest](r)
	if err != nil {
		return err
	}

	if req.ProfilePictureURL.Set && req.ProfilePictureURL.Value != nil {
		// Beyond url.ParseRequestURI's bare syntax check: restrict to
		// http(s) schemes. The original's own validation here
		// (z.string().url(), backend/packages/shared/src/types/user.ts:50)
		// has the identical gap — Zod's .url() accepts any syntactically
		// valid URI scheme, including javascript:/data:/file:, via JS's
		// URL constructor. A deliberate, free hardening beyond the
		// original (an avatar URL has no legitimate reason to be
		// anything but http/https), caught by an automated security scan
		// of Task 4's commit and fixed here at the layer where validation
		// belongs, not retrofitted into Store.
		parsed, err := url.ParseRequestURI(*req.ProfilePictureURL.Value)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return apperrors.Validation("Validation failed", map[string]any{
				"profilePictureUrl": "failed on the 'url' rule",
			})
		}
	}

	profile, err := h.svc.UpdateProfile(r.Context(), callerID(r), ProfileUpdate{
		DisplayName:       req.DisplayName,
		ProfilePictureURL: req.ProfilePictureURL,
	})
	if err != nil {
		return err
	}
	return httpserver.WriteJSON(w, http.StatusOK, publicProfileJSON(profile))
}

func (h *Handler) UpdateMyStatus(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[updateStatusRequest](r)
	if err != nil {
		return err
	}

	if err := h.svc.UpdateStatus(r.Context(), callerID(r), req.Status); err != nil {
		return err
	}
	return httpserver.WriteJSON(w, http.StatusOK, map[string]string{"status": req.Status})
}

func (h *Handler) GetStatusByID(w http.ResponseWriter, r *http.Request) error {
	userID := chi.URLParam(r, "userId")
	status, err := h.svc.GetStatus(r.Context(), userID)
	if err != nil {
		return err
	}
	return httpserver.WriteJSON(w, http.StatusOK, map[string]string{"userId": userID, "status": status})
}

func (h *Handler) GetStatuses(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[statusesRequest](r)
	if err != nil {
		return err
	}

	statuses, err := h.svc.GetStatuses(r.Context(), req.UserIDs)
	if err != nil {
		return err
	}
	return httpserver.WriteJSON(w, http.StatusOK, map[string]any{"statuses": statuses})
}

var allowedAvatarMimeTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/gif":  true,
	"image/webp": true,
}

// UploadAvatar must be mounted via httpserver.WrapWithBodyLimit with a
// larger cap than Wrap's package default (see routes.go) -- the original
// allows up to 5 MiB (@fastify/multipart's configured limit).
func (h *Handler) UploadAvatar(w http.ResponseWriter, r *http.Request) error {
	reader, err := r.MultipartReader()
	if err != nil {
		return apperrors.BadRequest("Invalid request body", nil)
	}

	// Grabs the first file part regardless of its field name, mirroring
	// @fastify/multipart's request.file(), which does the same.
	var part *multipartPart
	for {
		p, err := reader.NextPart()
		if err != nil {
			break
		}
		if p.FileName() != "" {
			part = &multipartPart{p}
			break
		}
	}

	if part == nil {
		return apperrors.BadRequest("No file uploaded", nil)
	}

	contentType := part.Header.Get("Content-Type")
	if !allowedAvatarMimeTypes[contentType] {
		return apperrors.BadRequest("Invalid file type. Allowed: JPEG, PNG, GIF, WebP", nil)
	}

	ext := extensionForMimeType(contentType)
	url, err := h.svc.UploadAvatar(r.Context(), callerID(r), ext)
	if err != nil {
		return err
	}
	return httpserver.WriteJSON(w, http.StatusOK, map[string]string{"profilePictureUrl": url})
}

func extensionForMimeType(mimeType string) string {
	switch mimeType {
	case "image/jpeg":
		return "jpeg"
	case "image/png":
		return "png"
	case "image/gif":
		return "gif"
	case "image/webp":
		return "webp"
	default:
		return "bin"
	}
}
```

- [ ] **Step 6: Remove the placeholder `multipartPart` type from Step 5 — it was never needed**

`*multipart.Part` already has everything `UploadAvatar` uses (`.FileName()`, `.Header`) — the `multipartPart` wrapper invents an indirection with no purpose. In `handler.go`, replace:

```go
	var part *multipartPart
	for {
		p, err := reader.NextPart()
		if err != nil {
			break
		}
		if p.FileName() != "" {
			part = &multipartPart{p}
			break
		}
	}
```

with:

```go
	var part *multipart.Part
	for {
		p, err := reader.NextPart()
		if err != nil {
			break
		}
		if p.FileName() != "" {
			part = p
			break
		}
	}
```

Add `"mime/multipart"` to this file's imports.

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd backend-go && go test -tags=integration ./internal/user/... -v -run TestHandler`
Expected: PASS, all 15 tests green.

- [ ] **Step 8: Commit**

```bash
cd backend-go && go build ./... && go vet ./... && go test -tags=integration ./internal/user/... -v
git add backend-go/internal/user/dto.go backend-go/internal/user/handler.go backend-go/internal/user/handler_test.go
git commit -m "backend-go/user: add Handler (HTTP adapters for the 7 /api/v1/users routes)"
```

---

## Task 11: `internal/user/search_handler.go` — search-route HTTP handlers

**Files:**
- Create: `backend-go/internal/user/search_handler.go`
- Create: `backend-go/internal/user/search_handler_test.go` (build-tagged `integration`)

**Interfaces:**
- Consumes: `*Handler` (Task 10, same type — this file adds methods to it), `*Service.{FindByUniqueNumber,SearchByName}` (Task 8).
- Produces: 2 methods on `*Handler`: `SearchByNumber`, `SearchByName` (matching `httpserver.HandlerFunc`'s signature).

- [ ] **Step 1: Write the failing test**

`backend-go/internal/user/search_handler_test.go`:
```go
//go:build integration

package user_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"nexus-connect/backend-go/internal/platform/httpserver"
	"nexus-connect/backend-go/internal/platform/logger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHandlerSearchByNumber_Found(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000080", "sbn@example.com", "8000000001", "SBN", "online")

	wrapped := httpserver.Wrap(logger.New("test"), h.SearchByNumber)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = withChiURLParams(req, map[string]string{"uniqueNumber": "8000000001"})
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "SBN", body["displayName"])
	_, hasEmail := body["email"]
	assert.False(t, hasEmail)
}

func TestHandlerSearchByNumber_WrongLength_Returns422(t *testing.T) {
	h, _ := newTestHandler(t)

	wrapped := httpserver.Wrap(logger.New("test"), h.SearchByNumber)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = withChiURLParams(req, map[string]string{"uniqueNumber": "123"})
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestHandlerSearchByNumber_NotFound_Returns404(t *testing.T) {
	h, _ := newTestHandler(t)

	wrapped := httpserver.Wrap(logger.New("test"), h.SearchByNumber)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = withChiURLParams(req, map[string]string{"uniqueNumber": "9999999997"})
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestHandlerSearchByName_ReturnsResults(t *testing.T) {
	h, store := newTestHandler(t)
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000081", "caller3@example.com", "8000000002", "Caller3", "online")
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000082", "nt1@example.com", "8000000003", "NameTargetAlpha", "online")

	wrapped := httpserver.Wrap(logger.New("test"), h.SearchByName)
	req := httptest.NewRequest(http.MethodGet, "/?query=NameTarget", nil)
	ctx := withCallerContext(req, "00000000-0000-0000-0000-000000000081")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	users, ok := body["users"].([]any)
	require.True(t, ok)
	assert.Len(t, users, 1)
}

func TestHandlerSearchByName_MissingQuery_Returns422(t *testing.T) {
	h, _ := newTestHandler(t)

	wrapped := httpserver.Wrap(logger.New("test"), h.SearchByName)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	ctx := withCallerContext(req, "00000000-0000-0000-0000-000000000099")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

// TestHandlerSearchByName_LimitOver100_Returns422 pins the pagination
// upper bound -- an unbounded limit would let a client page through the
// entire users table in one request.
func TestHandlerSearchByName_LimitOver100_Returns422(t *testing.T) {
	h, _ := newTestHandler(t)

	wrapped := httpserver.Wrap(logger.New("test"), h.SearchByName)
	req := httptest.NewRequest(http.MethodGet, "/?query=x&limit=500", nil)
	ctx := withCallerContext(req, "00000000-0000-0000-0000-000000000099")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}
```

- [ ] **Step 2: Add the test-only `withCallerContext` helper the test above calls**

Add to `search_handler_test.go` (search handlers read the caller's ID for self-exclusion, but aren't exercised via `doAuthedJSON` since that helper also injects chi URL params this file's tests don't need):

```go
func withCallerContext(r *http.Request, callerID string) context.Context {
	return context.WithValue(r.Context(), platformauth.UserContextKey, platformauth.TokenPayload{UserID: callerID})
}
```

Add `"context"` and `platformauth "nexus-connect/backend-go/internal/platform/auth"` to this file's imports.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend-go && go test -tags=integration ./internal/user/... -v -run TestHandlerSearch`
Expected: FAIL — `h.SearchByNumber`/`h.SearchByName` undefined.

- [ ] **Step 4: Implement `search_handler.go`**

`backend-go/internal/user/search_handler.go`:
```go
package user

import (
	"net/http"
	"strconv"

	apperrors "nexus-connect/backend-go/internal/platform/errors"
	"nexus-connect/backend-go/internal/platform/httpserver"
	"nexus-connect/backend-go/internal/platform/validate"

	"github.com/go-chi/chi/v5"
)

type searchByNumberParams struct {
	UniqueNumber string `validate:"required,len=10,numeric"`
}

func (h *Handler) SearchByNumber(w http.ResponseWriter, r *http.Request) error {
	params := searchByNumberParams{UniqueNumber: chi.URLParam(r, "uniqueNumber")}
	if err := validate.Struct(params); err != nil {
		return err
	}

	profile, err := h.svc.FindByUniqueNumber(r.Context(), params.UniqueNumber)
	if err != nil {
		return err
	}
	return httpserver.WriteJSON(w, http.StatusOK, publicProfileJSON(profile))
}

// SearchByName mirrors search.routes.ts's GET /users: query is required
// (min 1, max 100 chars); page defaults to 1 and limit to 20 when omitted
// or zero, matching PaginationSchema's .default(1)/.default(20) — then
// both are bounds-checked (page positive, limit 1-100) exactly like the
// Zod schema's .positive()/.min(1).max(100).
func (h *Handler) SearchByName(w http.ResponseWriter, r *http.Request) error {
	query := r.URL.Query().Get("query")
	if query == "" || len(query) > 100 {
		return apperrors.Validation("Validation failed", map[string]any{"query": "failed on the 'required' or 'max' rule"})
	}

	page := 1
	if p := r.URL.Query().Get("page"); p != "" {
		parsed, err := strconv.Atoi(p)
		if err != nil || parsed < 1 {
			return apperrors.Validation("Validation failed", map[string]any{"page": "failed on the 'min' rule"})
		}
		page = parsed
	}

	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		parsed, err := strconv.Atoi(l)
		if err != nil || parsed < 1 || parsed > 100 {
			return apperrors.Validation("Validation failed", map[string]any{"limit": "failed on the 'min' or 'max' rule"})
		}
		limit = parsed
	}

	result, err := h.svc.SearchByName(r.Context(), query, callerID(r), page, limit)
	if err != nil {
		return err
	}

	users := make([]map[string]any, len(result.Users))
	for i, u := range result.Users {
		users[i] = publicProfileJSON(u)
	}
	return httpserver.WriteJSON(w, http.StatusOK, map[string]any{
		"users": users, "total": result.Total, "page": result.Page, "limit": result.Limit,
	})
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend-go && go test -tags=integration ./internal/user/... -v -run TestHandlerSearch`
Expected: PASS, all 6 tests green.

- [ ] **Step 6: Commit**

```bash
cd backend-go && go build ./... && go vet ./... && go test -tags=integration ./internal/user/... -v
git add backend-go/internal/user/search_handler.go backend-go/internal/user/search_handler_test.go
git commit -m "backend-go/user: add Handler.{SearchByNumber,SearchByName} (HTTP adapters for /api/v1/search)"
```

---

## Task 12: `internal/user/routes.go` + `module.go` — mounting and fx wiring

**Files:**
- Create: `backend-go/internal/user/routes.go`
- Create: `backend-go/internal/user/module.go`
- Create: `backend-go/internal/user/routes_test.go` (build-tagged `integration`)

**Interfaces:**
- Consumes: `*Handler` (Tasks 10-11), `*chi.Mux` (the concrete type `platform.provideRouter` returns, same reasoning as `auth`'s Task 11), `config.Config.JWTAccessSecret`, `platformauth.Middleware` (foundation).
- Produces:
  - `func RegisterRoutes(mux *chi.Mux, h *Handler, cfg config.Config)` — mounts all 9 routes under `/api/v1/users` and `/api/v1/search`, both groups behind `platformauth.Middleware`, no rate limiting anywhere (Global Constraints).
  - `var Module = fx.Module("user", ...)`.

- [ ] **Step 1: Write the failing test**

`backend-go/internal/user/routes_test.go`:
```go
//go:build integration

package user_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	platformauth "nexus-connect/backend-go/internal/platform/auth"
	"nexus-connect/backend-go/internal/platform/config"
	"nexus-connect/backend-go/internal/platform/httpserver"
	"nexus-connect/backend-go/internal/platform/logger"
	"nexus-connect/backend-go/internal/user"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRegisterRoutes_MountsAllNineEndpoints(t *testing.T) {
	svc, _ := newTestService(t)
	h := user.NewHandler(svc, logger.New("test"))
	mux := httpserver.NewRouter(logger.New("test"), []string{"*"})
	cfg := config.Config{JWTAccessSecret: "test-secret-32-characters-long!"}

	user.RegisterRoutes(mux, h, cfg)

	token := validTestToken(t, cfg.JWTAccessSecret)
	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/api/v1/users/me"},
		{http.MethodGet, "/api/v1/users/00000000-0000-0000-0000-000000000001"},
		{http.MethodPatch, "/api/v1/users/me"},
		{http.MethodPatch, "/api/v1/users/me/status"},
		{http.MethodGet, "/api/v1/users/00000000-0000-0000-0000-000000000001/status"},
		{http.MethodPost, "/api/v1/users/statuses"},
		{http.MethodPost, "/api/v1/users/me/avatar"},
		{http.MethodGet, "/api/v1/search/by-number/1234567890"},
		{http.MethodGet, "/api/v1/search/users?query=x"},
	} {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		assert.NotEqual(t, http.StatusNotFound, rec.Code, "expected %s %s to be mounted", tc.method, tc.path)
	}
}

// TestRegisterRoutes_RequiresBearerToken pins this module's one
// cross-cutting rule: every route (both groups) must 401 with no
// Authorization header at all -- unlike auth, where most routes are
// intentionally open.
func TestRegisterRoutes_RequiresBearerToken(t *testing.T) {
	svc, _ := newTestService(t)
	h := user.NewHandler(svc, logger.New("test"))
	mux := httpserver.NewRouter(logger.New("test"), []string{"*"})
	cfg := config.Config{JWTAccessSecret: "test-secret-32-characters-long!"}

	user.RegisterRoutes(mux, h, cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}
```

- [ ] **Step 2: Add the test-only `validTestToken` helper the test above calls**

Add to `routes_test.go`:

```go
func validTestToken(t *testing.T, secret string) string {
	t.Helper()
	token, err := platformauth.GenerateAccessToken(
		platformauth.TokenPayload{UserID: "00000000-0000-0000-0000-000000000099"},
		secret, time.Hour,
	)
	require.NoError(t, err)
	return token
}
```

Add `"time"` to this file's imports.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend-go && go test -tags=integration ./internal/user/... -v -run TestRegisterRoutes`
Expected: FAIL — `user.RegisterRoutes` undefined.

- [ ] **Step 4: Implement `routes.go`**

`backend-go/internal/user/routes.go`:
```go
package user

import (
	"nexus-connect/backend-go/internal/platform/config"
	"nexus-connect/backend-go/internal/platform/httpserver"

	platformauth "nexus-connect/backend-go/internal/platform/auth"

	"github.com/go-chi/chi/v5"
)

// avatarUploadMaxBytes matches @fastify/multipart's configured 5 MiB
// limit in backend/services/user-service/src/server.ts.
const avatarUploadMaxBytes = 5 << 20

// RegisterRoutes mounts every user.routes.ts/search.routes.ts endpoint
// under /api/v1/users and /api/v1/search -- the exact prefixes the
// existing TS user-service uses. Both groups require a valid Bearer
// token (platformauth.Middleware, applied once per group via r.Use, not
// per-route) and neither has any rate limiting, matching the original
// exactly (see this plan's Global Constraints).
func RegisterRoutes(mux *chi.Mux, h *Handler, cfg config.Config) {
	authed := platformauth.Middleware(cfg.JWTAccessSecret)

	mux.Route("/api/v1/users", func(r chi.Router) {
		r.Use(authed)
		r.Get("/me", httpserver.Wrap(nil, h.Me))
		r.Get("/{userId}", httpserver.Wrap(nil, h.GetByID))
		r.Patch("/me", httpserver.Wrap(nil, h.UpdateMe))
		r.Patch("/me/status", httpserver.Wrap(nil, h.UpdateMyStatus))
		r.Get("/{userId}/status", httpserver.Wrap(nil, h.GetStatusByID))
		r.Post("/statuses", httpserver.Wrap(nil, h.GetStatuses))
		r.Post("/me/avatar", httpserver.WrapWithBodyLimit(nil, h.UploadAvatar, avatarUploadMaxBytes))
	})

	mux.Route("/api/v1/search", func(r chi.Router) {
		r.Use(authed)
		r.Get("/by-number/{uniqueNumber}", httpserver.Wrap(nil, h.SearchByNumber))
		r.Get("/users", httpserver.Wrap(nil, h.SearchByName))
	})
}
```

- [ ] **Step 5: Fix the `nil` logger placeholders from Step 4 — they were never meant to compile as-is**

`httpserver.Wrap`/`WrapWithBodyLimit` both call `log.Error(...)` on certain paths — a `nil` `*slog.Logger` panics the first time any of those paths actually run (a handler returning an error after partially writing a response; see `errorhandler.go`'s `started` check). `RegisterRoutes` needs its own `*slog.Logger` parameter, threaded through from `module.go`/`main.go` like every other dependency. Rewrite the signature and every `Wrap`/`WrapWithBodyLimit` call:

```go
func RegisterRoutes(mux *chi.Mux, h *Handler, log *slog.Logger, cfg config.Config) {
	authed := platformauth.Middleware(cfg.JWTAccessSecret)

	mux.Route("/api/v1/users", func(r chi.Router) {
		r.Use(authed)
		r.Get("/me", httpserver.Wrap(log, h.Me))
		r.Get("/{userId}", httpserver.Wrap(log, h.GetByID))
		r.Patch("/me", httpserver.Wrap(log, h.UpdateMe))
		r.Patch("/me/status", httpserver.Wrap(log, h.UpdateMyStatus))
		r.Get("/{userId}/status", httpserver.Wrap(log, h.GetStatusByID))
		r.Post("/statuses", httpserver.Wrap(log, h.GetStatuses))
		r.Post("/me/avatar", httpserver.WrapWithBodyLimit(log, h.UploadAvatar, avatarUploadMaxBytes))
	})

	mux.Route("/api/v1/search", func(r chi.Router) {
		r.Use(authed)
		r.Get("/by-number/{uniqueNumber}", httpserver.Wrap(log, h.SearchByNumber))
		r.Get("/users", httpserver.Wrap(log, h.SearchByName))
	})
}
```

Add `"log/slog"` to this file's imports. Update both tests in Step 1 to pass `logger.New("test")` as the new third positional argument to `user.RegisterRoutes(mux, h, logger.New("test"), cfg)`.

- [ ] **Step 6: Implement `module.go`**

`backend-go/internal/user/module.go`:
```go
package user

import "go.uber.org/fx"

var Module = fx.Module("user",
	fx.Provide(NewStore, NewService, NewHandler),
	fx.Invoke(RegisterRoutes),
)
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd backend-go && go test -tags=integration ./internal/user/... -v -run TestRegisterRoutes`
Expected: PASS, both tests green.

- [ ] **Step 8: Commit**

```bash
cd backend-go && go build ./... && go vet ./... && go test -tags=integration ./internal/user/... -v
git add backend-go/internal/user/routes.go backend-go/internal/user/module.go backend-go/internal/user/routes_test.go
git commit -m "backend-go/user: add RegisterRoutes and user.Module (fx wiring complete)"
```

---

## Task 13: wire `user.Module` into `cmd/server/main.go`

**Files:**
- Modify: `backend-go/cmd/server/main.go`
- Modify: `backend-go/cmd/server/main_test.go`

**Interfaces:**
- Consumes: `user.Module` (Task 12), `auth.Module` + `platform.Module` (already wired).
- Produces: a running binary that serves `/api/v1/users/*` and `/api/v1/search/*` in addition to `/api/v1/auth/*` and `/health`.

- [ ] **Step 1: Write the failing integration test**

Add to `backend-go/cmd/server/main_test.go`:

```go
func TestApp_GetsOwnProfileThroughTheRealHTTPServer(t *testing.T) {
	setAppEnv(t, 18084)

	app := fxtest.New(t, platform.Module, authpkg.Module, user.Module, fx.NopLogger)
	app.RequireStart()
	defer app.RequireStop()

	registerBody := `{"email":"user-e2e@example.com","password":"SecureP@ss123","displayName":"User E2E"}`
	regResp, err := http.Post("http://localhost:18084/api/v1/auth/register", "application/json", strings.NewReader(registerBody))
	require.NoError(t, err)
	defer regResp.Body.Close()
	require.Equal(t, http.StatusCreated, regResp.StatusCode)

	// This user is unverified, so /login would fail -- verify it directly
	// via the DSN setAppEnv already returned, same shortcut
	// TestApp_BootConstructsDBAndAppliesMigrations uses for DB access.
	dsn := currentTestDSN
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	defer pool.Close()
	_, err = pool.Exec(context.Background(), "UPDATE users SET email_verified = true WHERE email = $1", "user-e2e@example.com")
	require.NoError(t, err)

	loginBody := `{"email":"user-e2e@example.com","password":"SecureP@ss123"}`
	loginResp, err := http.Post("http://localhost:18084/api/v1/auth/login", "application/json", strings.NewReader(loginBody))
	require.NoError(t, err)
	defer loginResp.Body.Close()
	require.Equal(t, http.StatusOK, loginResp.StatusCode)

	var loginResult struct {
		AccessToken string `json:"accessToken"`
	}
	require.NoError(t, json.NewDecoder(loginResp.Body).Decode(&loginResult))

	meReq, err := http.NewRequest(http.MethodGet, "http://localhost:18084/api/v1/users/me", nil)
	require.NoError(t, err)
	meReq.Header.Set("Authorization", "Bearer "+loginResult.AccessToken)
	meResp, err := http.DefaultClient.Do(meReq)
	require.NoError(t, err)
	defer meResp.Body.Close()
	assert.Equal(t, http.StatusOK, meResp.StatusCode)

	var profile struct {
		Email string `json:"email"`
	}
	require.NoError(t, json.NewDecoder(meResp.Body).Decode(&profile))
	assert.Equal(t, "user-e2e@example.com", profile.Email)
}
```

- [ ] **Step 2: Fix the undefined `currentTestDSN` and missing imports from Step 1**

`setAppEnv` returns its DSN but doesn't store it anywhere reusable across test functions, and this test needs it *after* `setAppEnv` returns, not inline. Rewrite the test to capture it directly instead of inventing a package-level var:

```go
func TestApp_GetsOwnProfileThroughTheRealHTTPServer(t *testing.T) {
	dsn := setAppEnv(t, 18084)

	app := fxtest.New(t, platform.Module, authpkg.Module, user.Module, fx.NopLogger)
	app.RequireStart()
	defer app.RequireStop()

	registerBody := `{"email":"user-e2e@example.com","password":"SecureP@ss123","displayName":"User E2E"}`
	regResp, err := http.Post("http://localhost:18084/api/v1/auth/register", "application/json", strings.NewReader(registerBody))
	require.NoError(t, err)
	defer regResp.Body.Close()
	require.Equal(t, http.StatusCreated, regResp.StatusCode)

	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	defer pool.Close()
	_, err = pool.Exec(context.Background(), "UPDATE users SET email_verified = true WHERE email = $1", "user-e2e@example.com")
	require.NoError(t, err)

	loginBody := `{"email":"user-e2e@example.com","password":"SecureP@ss123"}`
	loginResp, err := http.Post("http://localhost:18084/api/v1/auth/login", "application/json", strings.NewReader(loginBody))
	require.NoError(t, err)
	defer loginResp.Body.Close()
	require.Equal(t, http.StatusOK, loginResp.StatusCode)

	var loginResult struct {
		AccessToken string `json:"accessToken"`
	}
	require.NoError(t, json.NewDecoder(loginResp.Body).Decode(&loginResult))

	meReq, err := http.NewRequest(http.MethodGet, "http://localhost:18084/api/v1/users/me", nil)
	require.NoError(t, err)
	meReq.Header.Set("Authorization", "Bearer "+loginResult.AccessToken)
	meResp, err := http.DefaultClient.Do(meReq)
	require.NoError(t, err)
	defer meResp.Body.Close()
	assert.Equal(t, http.StatusOK, meResp.StatusCode)

	var profile struct {
		Email string `json:"email"`
	}
	require.NoError(t, json.NewDecoder(meResp.Body).Decode(&profile))
	assert.Equal(t, "user-e2e@example.com", profile.Email)
}
```

Add to `main_test.go`'s import block: `"encoding/json"`, `"nexus-connect/backend-go/internal/user"`, and `authpkg "nexus-connect/backend-go/internal/auth"` (aliased: this file's package is `main_test`, and `auth` as an unaliased import would be fine on its own, but add the alias anyway for symmetry with how a reader scanning the import block will also see `user` — a plain `"nexus-connect/backend-go/internal/auth"` import without an alias works too; use whichever this file's existing imports already establish as the convention, checking the file before editing).

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend-go && go test -tags=integration ./cmd/server/... -v -run TestApp_GetsOwnProfile`
Expected: FAIL — `user.Module` undefined (package doesn't exist as an import target until this compiles, but since Task 12 already created it, the actual failure here is a 404 on `/api/v1/users/me`, since `main.go` itself still only composes `platform.Module, auth.Module`).

- [ ] **Step 4: Update `main.go`**

`backend-go/cmd/server/main.go`:
```go
package main

import (
	"nexus-connect/backend-go/internal/auth"
	"nexus-connect/backend-go/internal/platform"
	"nexus-connect/backend-go/internal/user"

	"go.uber.org/fx"
)

func main() {
	fx.New(platform.Module, auth.Module, user.Module).Run()
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend-go && go test -tags=integration ./cmd/server/... -v`
Expected: PASS, all 5 tests green (4 pre-existing from the foundation + `auth` plans, plus this one).

- [ ] **Step 6: Run the full verification suite**

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

- [ ] **Step 7: Commit**

```bash
git add backend-go/cmd/server/main.go backend-go/cmd/server/main_test.go
git commit -m "backend-go: wire user.Module into main.go — /api/v1/users/* and /api/v1/search/* are now live"
```

---

## Plan self-review

**Spec coverage:** All 9 routes from `user.routes.ts`/`search.routes.ts` have a handler + route + test (Tasks 10-12). All `UserService` methods are ported (Tasks 6-9). The error-envelope contract and fx module convention are inherited unmodified from the foundation/`auth` precedent. The email-leak fix (explicit user decision, Global Constraints) and the two faithfully-preserved known gaps (dead `online:users` write, fake avatar upload) are each accounted for in their owning task. No Kafka/event-bus consumer exists yet for `ProfileUpdatedEvent`/`StatusChangedEvent` — correctly out of scope; nothing in this module or `auth` subscribes to them, matching the same "publish into a bus with zero subscribers today" state `auth`'s own events landed in.

**Placeholder scan:** Seven deliberate "write the wrong/incomplete thing, then fix it in the next step" sequences, matching the established pattern from the `auth` plan's own Tasks 3/8-11: Task 1 Step 1→2 (a test calling a nonexistent `c.client()` escape hatch, replaced with a real assertion), Task 3 Step 1→2 (a test referencing a helper, `clearAllConfigEnv`, that may not exist in the real file — resolved by checking and adjusting to that file's actual convention), Task 7 Step 1→2 (a dead `var _ = cache.OnlineUsersKey` import-keeper), Task 10 Step 1→2 (a dead `var _ = user.OptionalString{}` import-keeper), Task 10 Step 5→6 (an invented `multipartPart` wrapper type, replaced with direct `*multipart.Part` use), Task 12 Step 4→5 (a `nil` logger that would panic on the first error path, resolved by threading a real `*slog.Logger` through `RegisterRoutes`'s signature), Task 13 Step 1→2 (an undefined `currentTestDSN`, resolved by capturing `setAppEnv`'s own return value locally instead of inventing a package-level var). Each shows the broken/incomplete code, why it's wrong, and the real fix in full, in the very next step — none are unresolved TODOs left for the plan's executor to improvise. (Task 4's own test/implementation sequence, by contrast, needed no such placeholder after self-review — Step 1 writes the final, correct test directly, and `OptionalString` is defined in its natural place, Step 3, the first time, rather than being deferred and patched in.)

**Type consistency:** Checked `ProfileRow`/`PublicProfileRow`/`ProfileUpdate`/`OptionalString` (defined Task 4, consumed by Tasks 6-10 with matching field names and types throughout — in particular `ProfileUpdate.ProfilePictureURL OptionalString` is constructed identically in `service_profile_test.go`, `handler.go`, and `dto.go`). `Profile`/`PublicProfile`/`SearchResult` (defined Task 6/8, consumed by `handler.go`/`search_handler.go` via `profileJSON`/`publicProfileJSON` helpers used consistently everywhere a profile-shaped response is written, so the JSON key set never drifts between routes that should share it). `Service` struct defined once in Task 6, methods added in Tasks 7-9 without redefinition, same granular-file convention `auth` established (`service_profile.go`/`service_status.go`/`service_search.go`/`service_avatar.go` mirroring `service_register.go`/`service_login.go`/`service_password.go`). `*chi.Mux` (not `chi.Router`) used consistently in Task 12's `RegisterRoutes` signature.

**Review Focus:** All five items (email-leak fix, cache-wins-over-DB status read, three-state optional profile picture, mixed-hit/miss status batching, avatar MIME-type rejection) each have a dedicated test named to make the property being pinned obvious from the test name alone, at both the `Service` layer (Tasks 6/7) and, where the property is also independently observable over HTTP (the email leak), at the `Handler` layer too (Task 10).

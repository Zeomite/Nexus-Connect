# Engineering Rules

Standards derived from the patterns actually used in this codebase, not aspirational ones. Each rule says whether it's an **established convention** (follow it) or a **proposed improvement** (not yet universal — apply when touching that area, don't block on retrofitting everywhere at once).

## Naming & code organization — established

- Each backend service follows `src/{index.ts, server.ts, config.ts, routes/*.routes.ts, services/*.service.ts, database/*, websocket/*, consumers/*}` — not every service has every folder (thin services like `expense-service` collapse everything into one file; this is acceptable for a service this size, don't force a split for its own sake).
- Shared code lives in `@nexus/shared` and is imported by package name, never by relative path across service boundaries (`../../packages/shared/...`). If you need something from shared in a service, export it from `backend/packages/shared/src/index.ts` first.
- Route files register a Fastify plugin per domain (`authRoutes`, `userRoutes`, `searchRoutes`); each route handler delegates business logic to a `*.service.ts` class/module rather than inlining SQL in the route — **except** the known exceptions already in the codebase (chat-service's WS handler duplicates `MessageService.markAsRead` logic with inline SQL instead of calling the service — don't copy this pattern, consolidate it if you touch that code).
- DB queries are centralized as named constants in `backend/packages/shared/src/database/queries/*.queries.ts` (e.g. `UserQueries.SELECT.PROFILE_BY_ID`) — **established and should be followed everywhere**; `user-service`'s `updateProfile` building SQL inline instead of using `UserQueries` is a known deviation, not a pattern to repeat.

## Type safety & validation — established, backend only

- All backend request bodies/params are validated with `zod` schemas before use (`validate()`/`safeValidate()` in `backend/packages/shared/src/utils/validators.ts`), raising a `ValidationError` (422) on failure. A few inline casts exist without zod validation (e.g. auth-service's `verify-email`, `verify-reset-code`, `update-password` bodies are cast, not parsed) — treat these as a gap to close, not the norm, when you touch that route.
- The frontend's `tsconfig.app.json` disables `strict`, `noImplicitAny`, `strictNullChecks`-equivalents, and unused-var checks — this is intentionally loose (shadcn/ui scaffold defaults), not a target to tighten as a side effect of unrelated work. Don't introduce `any` gratuitously even though the compiler allows it.

## API contracts & error handling — established

- Every thrown error that should produce a specific HTTP response extends `AppError` (`backend/packages/shared/src/utils/errors.ts`) and is caught by each service's global `setErrorHandler`, which calls `.toJSON()` to produce `{error: {code, message, details}}`. **Always throw a specific `AppError` subclass** (or add one) rather than a bare `Error` for anything a client should see distinctly — auth-service's `generateUniqueNumber` throwing a bare `Error` after max retries is a known deviation that surfaces as an unhelpful generic 500.
- Don't let a raw Postgres constraint violation reach the client as an unhandled 500 when a clean `AppError` exists for that case — auth-service's `/register` doesn't catch the unique-constraint race on concurrent duplicate emails/unique-numbers; if you touch that path, wrap the insert and map the Postgres error code to `DuplicateEmailError`.
- Routes that return a different (narrower) shape for "another user's profile" vs. "my own profile" must actually use a narrower query — `user-service`'s `GET /:userId` reuses the same `getProfile()` as `GET /me` and leaks `email`; don't copy this pattern for any new "look up another user" endpoint.

## Database access — established, with one bug to know

- All queries go through `PostgresClient.query`/`queryOne`/`transaction` (`backend/packages/shared/src/database/postgres.ts`); use `.transaction(fn)` for any multi-statement write that must be atomic (expense-service's expense+splits+ledger insert does this correctly — follow that pattern for new multi-table writes).
- Always parameterize — every query in the codebase uses `$1`/`$2` placeholders, never string interpolation. Keep it that way.
- **Fragile query pattern, verified not currently wrong** (harden if you touch that code): `expense-service`'s `GET /groups/:groupId/balances` (`BALANCES_BY_GROUP` in `backend/packages/shared/src/database/queries/expense.queries.ts`) selects `FROM ledger_entries, group_members WHERE ledger_entries.group_id = $1 AND group_members.group_id = $1` — an implicit comma-join with no predicate relating the two tables. It looks like a cross-join-inflation bug at a glance (an earlier pass through this codebase assumed exactly that), but a row-by-row simulation shows `GROUP BY user_id` — where `user_id` unambiguously resolves to `group_members.user_id`, the only column of that name in scope — partitions the cross product back down to exactly one `group_members` row per distinct `user_id` (guaranteed by that table's `(group_id, user_id)` primary key), so each group's aggregate correctly sums over exactly the group's `N` ledger entries, not `N × member_count`. **The output is numerically correct today.** It's still worth rewriting as an explicit query (drop `group_members` from the `FROM` and derive user IDs from `ledger_entries` directly, or use a real `JOIN ... ON` if you need to include zero-balance members) because the current form is fragile: it relies on an unenforced invariant (no other table in scope ever gaining a bare `user_id` column) and is easy to misread as buggy, as this harness's own first pass demonstrates. If you touch this query, add a test fixing the current (correct) behavior before refactoring it.
- TOCTOU races: check-then-insert patterns (email-exists check before insert, unique-number-exists check before insert) rely on the DB's `UNIQUE` constraint as the real backstop, not the application check — the application check is a cheap pre-filter for the common case, not a correctness guarantee. Don't remove the DB constraint, and don't assume the app-level check alone is sufficient when adding similar logic elsewhere.

## Concurrency, retries, idempotency — proposed improvement area

- Kafka publishes are fire-and-forget (`KafkaClient.publish()` logs and swallows errors) — this is intentional per the code's own comment ("Kafka failures shouldn't block operations"). **Established**: don't make a user-facing request fail just because an event publish failed. **Gap**: there is no outbox pattern or retry queue, so a failed publish is silently lost — if you're adding a workflow where losing an event is unacceptable (e.g. billing), don't rely on `publish()` alone.
- `notification-service`'s missed-call email handler does not catch its own `sendMail` call, so an SMTP failure throws inside the Kafka `eachMessage` handler, which re-throws per `KafkaClient.subscribe()`'s own `catch` block — kafkajs then retries the same message indefinitely with no DLQ routing despite `nexus.dlq.notifications` being defined. **When touching any Kafka consumer handler, wrap it so a downstream failure (email, HTTP call, etc.) doesn't become an infinite reprocessing loop** — catch, log, and either route to the DLQ topic or drop with a clear log line, matching the pattern already used for Kafka *publish* failures.
- Blocking `redis.keys()` is used in `call-signaling-service`'s `getPendingCalls` — avoid `KEYS` in new code; use `SCAN` with a cursor, or better, a Redis Set/Sorted Set keyed by user so lookup is O(1) instead of O(n) over the whole keyspace.

## Rate limiting — inconsistent today, pick deliberately

- `createApiRateLimiter`/`createAuthRateLimiter`/`createLoginRateLimiter`/etc. exist in `@nexus/shared` and are wired up in `auth-service` only. `chat-service` and `user-service` register no rate limiting at all (not even the generic `rateLimitPlugin`). If you're adding a new public-facing route, decide explicitly whether it needs rate limiting rather than copying whichever sibling service you looked at last — auth-service is the example to copy, not chat/user-service.

## Security & sensitive data — established

- `createLogger()` auto-redacts `password`/`token`/`refreshToken`/`accessToken` fields (`backend/packages/shared/src/utils/logger.ts`) — rely on this, but remember it only catches those exact key names; don't log a secret under a different key name and assume it's safe.
- Passwords: bcrypt, 12 rounds, never logged or returned in any response shape (verified across auth-service routes).
- See [SECURITY.md](SECURITY.md) for the full picture, including the known gaps (hardcoded dev-secret fallbacks, localStorage token storage, unauthenticated media-service).

## Reuse & duplication — flagged, not yet fixed

- Frontend: `NotificationContext` and the `useIncomingCall` hook independently re-implement nearly identical WebSocket-subscription/reconnect/polling-fallback logic against the same singleton `NotificationWebSocket` — only the hook's state is actually consumed by any component. If you're touching incoming-call handling, consolidate into one, don't add a third copy.
- Frontend: three WebSocket client classes (`Chat`, `Notification`, `Signaling`) each hand-roll their own reconnect/backoff/heartbeat instead of sharing a base class — acceptable as-is (small enough to not force an abstraction), but don't add a fourth without at least considering extracting the common piece.
- `useOptimisticMessage` (`frontend/src/lib/api/hooks.ts`) is defined and unused — either wire it up or remove it when you're in that file; don't leave a second one next to it.

## Comments & maintainability

- Existing code favors short inline comments only at genuine gotchas (e.g. the explicit `// TODO: Implement actual S3 upload` in `user-service`, the "Kafka failures shouldn't block operations" comment) — match that density. Don't add narrative comments restating what a well-named function already says.
- When you find a stub masquerading as working code (like the avatar upload), leave or add an explicit comment saying so, the way the existing TODO does — silent stubs are the most expensive kind of technical debt in this codebase because nothing else (no tests, no types) will catch them.

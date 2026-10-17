# auth-service — AGENTS.md

Port 3001. **Deployable**: Dockerfile + docker-compose + k8s Deployment exist. 0 tests.

## Purpose

Registration, email verification, login, token refresh/rotation, password reset. The only service that issues JWTs; every other service verifies them against the same `JWT_ACCESS_SECRET`.

## Entry point & startup

`src/index.ts` → `src/server.ts`. Registers cors/helmet/sensible/swagger (`/docs`) — **no `authPlugin`** (this service issues tokens, doesn't consume them). Decorates `postgres`/`redis`/`kafka`. Global error handler maps `AppError` → status/`toJSON()`. Required env: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (both fall back to hardcoded dev placeholders if unset — see [SECURITY.md](../../../SECURITY.md)), `POSTGRES_*`, `REDIS_*`, `KAFKA_BROKERS`; `SMTP_*` optional (email degrades silently, see below).

`src/database/migrate.ts` is a standalone migration runner tracking only this service's `users` table (independent of `infrastructure/postgres/init.sql`, which bootstraps everything at container init). `package.json`'s `"seed"` script points at a `dist/database/seed.js` that **has no source file** — running it will fail.

## Routes (`/api/v1/auth`, all unauthenticated by design)

| Route | Validation | Notes |
|---|---|---|
| `POST /register` | `RegisterUserSchema` | Generates unique 10-digit number (retries ×10). Not wrapped against the DB unique-constraint race — see Known limitations. |
| `POST /login` | `LoginUserSchema` | bcrypt compare, updates `last_seen_at` |
| `POST /refresh` | `RefreshTokenSchema` | Rotates refresh token (deletes old, issues new) via Redis |
| `POST /logout` | `RefreshTokenSchema` | Deletes stored refresh token |
| `POST /verify-email` | inline cast, no zod | **6-digit code**, not a token link — differs from `../../docs/api-contracts.md`'s documented shape |
| `POST /resend-verification` | `ForgotPasswordSchema` (reused) | |
| `POST /forgot-password` | `ForgotPasswordSchema` | Always returns success regardless of whether email exists (anti-enumeration, intentional) |
| `POST /verify-reset-code` | inline cast | Step 2 of 3 |
| `POST /update-password` | inline cast | Step 3 of 3. **Does not revoke existing refresh tokens** — explicit in-code comment acknowledges this |

The documented `/reset-password` single-step endpoint in `../../docs/api-contracts.md` **does not exist in code** — the real flow is the 3-step one above, which the frontend already calls. Update the doc, not the code, if you touch this.

## Business rules / invariants

- Password: 8-128 chars, upper+lower+digit+special (`PasswordStrengthSchema`, shared).
- bcrypt 12 rounds.
- Verification/reset codes: 6-digit, generated with `Math.random()` (not a CSPRNG — see [SECURITY.md](../../../SECURITY.md)), 24h TTL in Redis.
- Reset-flow intermediate state keyed as raw string `password_reset_verified:${email}` — bypasses the `SessionKeys` helper used everywhere else; if you touch this flow, either fix it to use `SessionKeys` or note why not.
- Email send is fire-and-forget: `EmailService` catches and logs all SMTP errors, never throws — a registration can succeed while the verification email silently fails to send, and the caller has no way to know.

## Known limitations

- **Race condition**: concurrent duplicate registrations (same email or colliding unique-number) can both pass the pre-insert existence check before either inserts; the DB `UNIQUE` constraint is the real backstop, but the second request's raw Postgres error isn't caught, so it surfaces as a generic 500 instead of a clean `DuplicateEmailError` (409). Fix: wrap the `INSERT.USER` call and map the Postgres unique-violation code.
- `config.ts`'s `rateLimit` object (`loginWindow`/`registerMax`/etc.) is **dead code** — routes actually use `@nexus/shared`'s `createAuthRateLimiter`/`createLoginRateLimiter`, which hardcode their own windows independently. If you mean to change rate limits, you're editing the wrong object unless you also wire it in.
- No seed script despite being referenced in `package.json`.

## Testing

0 tests. Highest-value first test: the unique-number retry logic and the register-race behavior described above (see [TESTING.md](../../../TESTING.md)).

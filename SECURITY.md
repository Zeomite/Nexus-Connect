# Security

Verified facts about authentication, authorization, secrets, and input handling — plus known gaps found while reading every service. No credential, token, or key value from this repo appears below; only variable names and placeholder patterns already present in `.env.example`/k8s manifests are referenced.

## Authentication

- **Scheme**: JWT access tokens (15m default) + refresh tokens (7d default), issued by `auth-service` only. Refresh tokens are stored server-side in Redis (`SessionKeys.refreshToken`) and rotated on use (old one deleted, new one issued) — this makes refresh-token revocation on logout possible and is a correct pattern to keep.
- **Verification**: every other service that needs auth registers `@nexus/shared`'s `authPlugin` as an `onRequest` hook, checking `Authorization: Bearer <token>` against the **same shared `JWT_ACCESS_SECRET`** used by auth-service to sign it. There is no per-service signing key and no service-to-service mTLS/API-key layer — `authenticateService()` exists in shared middleware (`x-service-auth`/`x-service-name` headers) but is **not called anywhere** in any service's route registration (confirmed: no caller found in any service's `server.ts`/routes).
- **Password hashing**: bcrypt, 12 rounds (`SALT_ROUNDS` in `backend/packages/shared/src/utils/crypto.ts`) — reasonable, don't lower this.
- **Email verification**: 6-digit numeric code generated with `Math.random()` (not `crypto.randomInt`), 24h TTL in Redis. This differs from the token-link flow `backend/docs/api-contracts.md` documents — the code implementation is what's real and what the frontend calls. Using `Math.random()` for a security-relevant code (rather than the `crypto.randomBytes`-based `generateSecureToken()` already available in the same file) is weaker than necessary; a 6-digit space is only 10^6 possibilities and isn't rate-limited per-code-guess beyond the generic `authRateLimiter` on the endpoint — low severity given the TTL and combined-with-email requirement, but worth hardening if this code is ever exposed beyond a trusted frontend.
- **Password reset**: 3-step flow (`forgot-password` → `verify-reset-code` → `update-password`), same 6-digit-code mechanism. **Known gap, explicit in code comments**: successfully changing a password does **not** invalidate existing refresh tokens — a stolen refresh token remains valid after the legitimate user resets their password believing they've locked out an attacker.

## Authorization

- **Row-level checks**: group-service enforces owner/admin/member role permissions via `getGroupPermissions(role)` — gating edit/add-member/remove-member correctly, confirmed by code read.
- **Known gap**: `user-service`'s `GET /:userId` (fetch another user's profile by ID) reuses the exact same `getProfile()` query used for `GET /me`, which includes the **email address** — any authenticated user can retrieve any other user's email via this endpoint, not just the public-safe fields (`displayName`/`uniqueNumber`/`profilePictureUrl`/`status`) that the search endpoints correctly restrict to. This is a real data-exposure issue to fix before this endpoint is relied on for anything beyond trusted internal use.
- **`media-service` has no authentication plugin registered at all** — every route is open to any caller who can reach the service's port. It isn't exposed through the gateway today ([INFRASTRUCTURE.md](INFRASTRUCTURE.md)), which limits blast radius in the current compose/k8s setup, but **do not deploy it behind a public path without adding `authPlugin` first** — this is not a "someday" cleanup, it's a precondition for exposing the service at all.

## Secrets management

- Every service reads JWT/DB/Redis secrets from environment variables and **falls back to a hardcoded dev placeholder if unset** (e.g. `'access-secret-change-in-production'` in `auth-service/src/config.ts`). This fails *open* to a known, guessable value rather than failing to start — the opposite of a safe default. Before any deployment beyond a developer's own machine, confirm every required secret env var is actually set; don't trust the service starting successfully as proof the secrets are configured.
- `.env` is gitignored (`.gitignore` excludes `.env`, `.env.*`, keeps `.env.example`) — correct. No real secret values were found committed anywhere in the repo during this review.
- k8s `configmap.yaml` includes an inline `Secret` manifest with placeholder `stringData` values (e.g. `"change-me-in-production"`) committed in plaintext YAML — fine as a template since the values are explicitly placeholders, but **do not fill in real values in this file and commit it**; use a real secret manager (sealed-secrets, external-secrets, Vault) for actual deployments, which `backend/README.md` also recommends.

## Input validation

- Backend: zod schemas validate nearly every request body/params (see [ENGINEERING_RULES.md](ENGINEERING_RULES.md)); a few auth-service endpoints (`verify-email`, `verify-reset-code`, `update-password`) cast request bodies without zod validation — lower risk since they're narrow shapes, but inconsistent with the rest of the codebase's convention.
- SQL: 100% parameterized queries verified across every service read — no string-interpolated SQL found anywhere. Keep it that way; this is the single most consistently-followed safety practice in the codebase.
- XSS: `sanitizeString()` exists in shared utils but its usage was not verified across every message/content field — message `content` is stored and relayed as-is in chat-service; the frontend renders message content as React children (not `dangerouslySetInnerHTML`, per the frontend fork's read of `ChatMessage.tsx`), which gives React's default escaping as a backstop — don't add any `dangerouslySetInnerHTML` to message rendering without explicit sanitization first.

## Sensitive data handling

- Logging: `createLogger()` auto-redacts `password`/`token`/`refreshToken`/`accessToken` keys (see [ENGINEERING_RULES.md](ENGINEERING_RULES.md)) — relied on throughout, works as designed.
- **Frontend token storage**: access + refresh tokens and the user object are stored in `localStorage` (`nexus_access_token`, `nexus_refresh_token`, `nexus_user` — `frontend/src/lib/api/client.ts`), not httpOnly cookies. Any XSS on the frontend (e.g. via an un-sanitized render path) can exfiltrate both tokens directly. This is a real, current risk, not a hypothetical — it's the standard trade-off of token-in-localStorage vs. the CSRF trade-offs of cookie storage, but should be a deliberate choice, not a default to leave unexamined if this app ever handles higher-sensitivity data.
- Rate limiting is skipped entirely in `NODE_ENV=development` (`rate-limiter.ts`) by design — correct for local dev, but double-check `NODE_ENV` is actually `production` in every real deployment, since the rate limiter silently no-ops otherwise with no warning log.

## CORS & headers

- `@fastify/helmet` and `@fastify/cors` are registered in every service that has a `server.ts` — CORS origins come from `CORS_ORIGINS` env var (comma-separated). nginx also sets `X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection`, `Referrer-Policy` at the gateway layer (`nginx.conf`) — this only applies to the 4 services the gateway actually routes to.

## Summary of open security gaps (ranked)

1. `media-service` has zero authentication on any route.
2. `user-service` `GET /:userId` leaks another user's email.
3. Password reset doesn't revoke existing refresh tokens.
4. Every service fails open to a hardcoded dev secret if env vars are misconfigured.
5. Frontend stores tokens in `localStorage`, exposed to any XSS.
6. Email-verification/reset codes use `Math.random()` instead of a CSPRNG.

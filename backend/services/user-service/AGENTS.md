# user-service — AGENTS.md

Port 3002. **Deployable**: Dockerfile + docker-compose + k8s Deployment exist. 0 tests.

## Purpose

Profile CRUD, online/offline/busy/away/do_not_disturb status (Redis-cached over Postgres), search by unique-number/name, avatar "upload" (currently fake — see below).

## Entry point & startup

`src/index.ts` → `src/server.ts`. Registers `@fastify/multipart` (5MB limit) in addition to the standard cors/helmet/sensible/swagger. **Registers `authPlugin`** (excludes `/health*`, `/docs*`) — every route below requires a valid Bearer token against the shared `JWT_ACCESS_SECRET`. No rate limiting is registered anywhere in this service (unlike auth-service). No migration file — relies entirely on `infrastructure/postgres/init.sql`.

## Routes

`/api/v1/users` (`src/routes/user.routes.ts`):

| Route | Notes |
|---|---|
| `GET /me` | Own profile, includes email |
| `GET /:userId` | **Reuses the same query as `/me` — leaks another user's email to any authenticated caller.** Known security gap, see [../../../SECURITY.md](../../../SECURITY.md). Undocumented in `api-contracts.md`. |
| `PATCH /me` | Builds its `UPDATE` SQL inline instead of via `UserQueries` — inconsistent with the rest of the codebase; publishes `USER_PROFILE_UPDATED` |
| `PATCH /me/status` | Writes Redis (`userStatus` key, 300s TTL) + `onlineUsers()` set membership, then DB; publishes `USER_STATUS_CHANGED`. The `onlineUsers()` set is written but **never read anywhere** — dead write, likely scaffolding for an unbuilt presence feature |
| `GET /:userId/status` | Redis-first, DB fallback |
| `POST /statuses` | Batch status lookup, Redis pipeline + DB fallback for misses |
| `POST /me/avatar` | **Does not upload to S3.** Reads the file into memory, discards it, fabricates a `https://{bucket}.s3.../avatars/{filename}` URL and writes that to the DB. Explicit `// TODO: Implement actual S3 upload` in `user.service.ts`. The 200 response is real; the URL is not. |

`/api/v1/search` (`src/routes/search.routes.ts`):

| Route | Notes |
|---|---|
| `GET /by-number/:uniqueNumber` | zod `^\d{10}$`, returns narrow public shape (correct) |
| `GET /users?query=&page=&limit=` | `ILIKE '%query%'` — leading wildcard can't use the plain btree index on the name column; fine at current scale, revisit if search gets slow |

## Business rules / invariants

- Status cache (Redis) is authoritative for up to 300s; DB is durable fallback. `getStatuses` batches via Redis pipeline then one DB query for misses — don't regress this into N+1.
- `STORAGE_*` env vars (S3 bucket/region/keys) are read into config but **never used anywhere** — no S3 client is ever constructed. Don't assume setting these env vars makes avatar upload work; it doesn't yet.

## Known limitations

- Avatar upload is a non-functional stub presented as a working 200 response (see above) — this is the most important thing to know before touching `user.service.ts`'s upload path.
- `GET /:userId` email leak — fix by giving it the same narrow public-profile shape search already uses correctly.
- No rate limiting on any route, including search and avatar upload.

## Testing

0 tests. Highest-value first targets: the Redis/DB status-cache fallback logic, and a regression test for the `/:userId` shape once the email leak is fixed.

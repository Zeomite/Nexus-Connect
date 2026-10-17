# backend/packages/shared/ — AGENTS.md (`@nexus/shared`)

## Purpose

Single dependency every backend service imports for: Postgres/Redis/Kafka clients, JWT/bcrypt/crypto helpers, Fastify auth + rate-limit plugins, zod validators, `AppError` hierarchy, pino logger, and typed Kafka domain events + topic registry. Owns no database tables itself.

## Key files (`src/`)

| File | What it provides |
|---|---|
| `database/postgres.ts` | `PostgresClient` (pool wrapper: `query`/`queryOne`/`transaction`/`healthCheck`), `createPostgresClient(serviceName)` from env |
| `database/redis.ts` | `RedisClient` (typed wrapper over ioredis incl. pub/sub, Lua `eval`), `SessionKeys` — the canonical key-naming helpers (use these, don't hand-roll a Redis key string) |
| `database/queries/*.queries.ts` | Centralized named SQL constants per domain (`UserQueries`, `ChatQueries`, `CallQueries`, `GroupQueries`, `ExpenseQueries`) — the established pattern every service should query through |
| `messaging/kafka.ts` | `KafkaClient` — producer/consumer/admin wrapper. `publish()` is **fire-and-forget**: catches and logs failures, never throws. `subscribe()`'s handler wrapper re-throws on failure (triggers kafkajs retry) — see [../../../ENGINEERING_RULES.md](../../../ENGINEERING_RULES.md) for the DLQ gap this creates |
| `messaging/topics.ts` | `KafkaTopics`, `TopicConfigurations` (partitions/retention), `ConsumerGroups` — add new topics here, not as inline strings in a service |
| `middleware/auth.ts` | `authPlugin` (Fastify `onRequest` hook verifying `Authorization: Bearer`), `authenticateWebSocket`, `authenticateService` (service-to-service header check — **defined but not called by any service today**, confirmed) |
| `middleware/rate-limiter.ts` | Sliding-window Redis-Lua rate limiter + pre-configured limiters (`createAuthRateLimiter`, `createLoginRateLimiter`, `createApiRateLimiter`, etc.) — **no-ops entirely when `NODE_ENV=development`** |
| `utils/errors.ts` | `AppError` + subclasses (`BadRequestError`, `UnauthorizedError`, `ValidationError`, `DuplicateEmailError`, `CallInProgressError`, etc.) — every service's global error handler expects these, via `.toJSON()` |
| `utils/crypto.ts` | bcrypt (12 rounds), JWT sign/verify/rotate helpers, AES-256-GCM encrypt/decrypt (unused E2E-encryption hooks), `generateRoomId` |
| `utils/id-generator.ts` | UUID v4/time-ordered, 10-digit unique-number generator (retry-based), short IDs, `SnowflakeGenerator` (defined, unverified whether any service actually uses it over UUIDs) |
| `utils/validators.ts` | `validate`/`safeValidate` (zod → `ValidationError`), `PaginationSchema`, `PasswordStrengthSchema`, `sanitizeString` |
| `types/*.ts` | Domain types per area (`user`, `chat`, `call`, `group`, `expense`), `types/events.ts` — all `DomainEvent` shapes published over Kafka |

## Invariants

- `publish()` never throws — callers must not treat a successful HTTP response as proof an event was delivered.
- `authPlugin` requires `excludePaths`/`excludePatterns` to be set correctly per service (health/docs routes must be excluded) — get this wrong and you lock out your own health check.
- `PostgresClient` pool defaults to `max: 20` — every service shares this default unless it overrides `POSTGRES_POOL_MAX`; be mindful of total connections across all running services against one Postgres instance.

## Testing

No tests exist for this package (same as everywhere in the backend — see [../../../TESTING.md](../../../TESTING.md)). Given every service depends on it, this is the single highest-leverage place to add unit tests first — e.g. the rate-limiter Lua script, the unique-number generator's retry logic, `AppError.toJSON()` shape.

## Safe extension points

- New error type → add to `utils/errors.ts`, extend `AppError`, give it a stable `code` string (clients may match on it).
- New Kafka event → add the type to `types/events.ts`'s `DomainEvent` union and a constant to the relevant `*EventTypes` object in the same file, plus the topic to `messaging/topics.ts` if it's new.
- New query → add to the relevant `*.queries.ts` file as a named constant, not inline SQL in a service.

## Known limitations

- `authenticateService` (service-to-service auth) is dead code — no caller anywhere.
- E2E encryption helpers (`encryptData`/`decryptData`/`deriveKey`) exist but are not wired into any message/call flow — `backend/README.md`'s "E2E Encryption Hooks" section describes these as available primitives, not an active feature, which matches reality.

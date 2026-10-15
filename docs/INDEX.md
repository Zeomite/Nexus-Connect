# Repository Index

Hand-curated map from concept → source file. Not generated — see [standards/markdown-authoring.md](standards/markdown-authoring.md) for why a curated index was chosen over a generated one at this repo's size, and [../scripts/validate-docs.mjs](../scripts/validate-docs.mjs) for the structural checks that keep links here honest. **This index does not re-verify facts on a schedule** — if you change a route, table, or topic, update the row here in the same change.

## Entry points

| Module | Boot file |
|---|---|
| auth-service | [`backend/services/auth-service/src/index.ts`](../backend/services/auth-service/src/index.ts) |
| user-service | [`backend/services/user-service/src/index.ts`](../backend/services/user-service/src/index.ts) |
| chat-service | [`backend/services/chat-service/src/index.ts`](../backend/services/chat-service/src/index.ts) |
| call-signaling-service | [`backend/services/call-signaling-service/src/index.ts`](../backend/services/call-signaling-service/src/index.ts) |
| media-service | [`backend/services/media-service/src/index.ts`](../backend/services/media-service/src/index.ts) |
| group-service | [`backend/services/group-service/src/index.ts`](../backend/services/group-service/src/index.ts) |
| expense-service | [`backend/services/expense-service/src/index.ts`](../backend/services/expense-service/src/index.ts) |
| notification-service | [`backend/services/notification-service/src/index.ts`](../backend/services/notification-service/src/index.ts) |
| call-history-service | [`backend/services/call-history-service/src/index.ts`](../backend/services/call-history-service/src/index.ts) |
| frontend | [`frontend/src/main.tsx`](../frontend/src/main.tsx) |

## HTTP route files (read these, not a generated OpenAPI spec — none exists)

| Service | Route file(s) |
|---|---|
| auth-service | [`src/routes/auth.routes.ts`](../backend/services/auth-service/src/routes) |
| user-service | [`src/routes/user.routes.ts`, `src/routes/search.routes.ts`](../backend/services/user-service/src/routes) |
| chat-service | [`src/routes/`](../backend/services/chat-service/src/routes) (chat + message routes) |
| call-signaling-service | [`src/routes/`](../backend/services/call-signaling-service/src/routes) |
| media-service, group-service, expense-service, notification-service, call-history-service | single-file services — routes live inline in each `src/index.ts` or a lone route module; see each service's `AGENTS.md` for the verified route table rather than browsing |

Full documented contract (for the 4 deployable services, with known drift noted in each service's `AGENTS.md`): [`backend/docs/api-contracts.md`](../backend/docs/api-contracts.md).

## WebSocket & event handlers

| What | Where |
|---|---|
| Chat WS protocol | [`backend/services/chat-service/src/websocket/`](../backend/services/chat-service/src/websocket), contract doc [`backend/docs/websocket-events.md`](../backend/docs/websocket-events.md) |
| Chat Kafka consumer | [`backend/services/chat-service/src/consumers/`](../backend/services/chat-service/src/consumers) |
| Signaling WS protocol | [`backend/services/call-signaling-service/src/websocket/`](../backend/services/call-signaling-service/src/websocket) |
| Signaling Kafka consumer (answered/declined/ended are empty stubs) | [`backend/services/call-signaling-service/src/consumers/call.consumer.ts`](../backend/services/call-signaling-service/src/consumers) |
| Call-history Kafka consumer | `backend/services/call-history-service/src/index.ts` (single file) |
| Notification Kafka consumer (uncaught-SMTP-failure bug here) | `backend/services/notification-service/src/index.ts` (single file) |
| Kafka topic registry | [`backend/packages/shared/src/messaging/topics.ts`](../backend/packages/shared/src/messaging/topics.ts) |
| Domain event type definitions | [`backend/packages/shared/src/types/events.ts`](../backend/packages/shared/src/types/events.ts) |

## Models, schemas, repositories

| What | Where |
|---|---|
| Full DB schema (all 9 services' tables, one file) | [`backend/infrastructure/postgres/init.sql`](../backend/infrastructure/postgres/init.sql) |
| Centralized SQL query constants | [`backend/packages/shared/src/database/queries/`](../backend/packages/shared/src/database/queries) (`user`, `chat`, `call`, `group`, `expense` — `expense.queries.ts`'s `BALANCES_BY_GROUP` is the fragile-but-correct comma-join query discussed in [ENGINEERING_RULES.md](../ENGINEERING_RULES.md)) |
| Postgres pool wrapper | [`backend/packages/shared/src/database/postgres.ts`](../backend/packages/shared/src/database/postgres.ts) |
| Redis wrapper + key-naming helpers | [`backend/packages/shared/src/database/redis.ts`](../backend/packages/shared/src/database/redis.ts) |
| Domain types (non-event) | [`backend/packages/shared/src/types/`](../backend/packages/shared/src/types) |
| Frontend's hand-maintained type mirror | [`frontend/src/lib/api/types.ts`](../frontend/src/lib/api/types.ts) |

## Jobs, schedulers, async flows

There is no cron/scheduler library anywhere in the repo (confirmed — no `node-cron`, `agenda`, k8s `CronJob` manifest, etc.). All asynchronous work is Kafka consumer-driven (see table above). No sweep/reconciliation job exists for orphaned call rows (see [ARCHITECTURE.md](../ARCHITECTURE.md) risk around restart-mid-call).

## External integrations

| Integration | Status | Where |
|---|---|---|
| SMTP (nodemailer) | Real, used by auth-service (verification/reset emails) and notification-service | `backend/services/auth-service/src/services/`, `backend/services/notification-service/src/index.ts` |
| S3 (avatar storage) | **Not implemented** — config read, no client constructed | `backend/services/user-service/src/services/user.service.ts` |
| mediasoup (SFU) | Partial — Workers/Routers/Transports real, no produce/connect/consume | `backend/services/media-service/src/workers/` |
| TURN | **Not implemented** — env vars documented, never read | n/a |
| WebRTC (client-side) | Real, mesh P2P | `frontend/src/pages/Call.tsx` |

## Tests

| Where | What |
|---|---|
| `frontend/src/test/example.test.ts` | The only real test file in the repository; trivial placeholder |
| Everywhere else | No test files exist — see [TESTING.md](../TESTING.md) for the full accounting and what to prioritize writing first |

## Configuration & operational scripts

| File | Purpose |
|---|---|
| [`backend/.env.example`](../backend/.env.example) | Local env template — see [`backend/docs/environment.md`](../backend/docs/environment.md) for the full reference |
| [`backend/docker-compose.yml`](../backend/docker-compose.yml) | Local orchestration — 4 of 9 services only |
| [`frontend/docker-compose.yml`](../frontend/docker-compose.yml) | Frontend-only container |
| [`backend/infrastructure/nginx/nginx.conf`](../backend/infrastructure/nginx/nginx.conf) | Local API gateway routing |
| [`backend/infrastructure/kubernetes/`](../backend/infrastructure/kubernetes) | k8s manifests — ingress ahead of deployments, see [INFRASTRUCTURE.md](../INFRASTRUCTURE.md) |
| [`backend/services/auth-service/src/database/migrate.ts`](../backend/services/auth-service/src/database/migrate.ts) | The only real migration runner in the repo |
| [`scripts/validate-docs.mjs`](../scripts/validate-docs.mjs) | This harness's own validation script — see header comment for usage |

## Regenerating / maintaining this index

This file is manually maintained, not generated. When you add a service, route file, consumer, or integration, add a row here in the same change. `node scripts/validate-docs.mjs` verifies every link above resolves to a real file — it does not verify the table contents are still accurate, which is a human (or agent) responsibility.

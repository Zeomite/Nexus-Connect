# Infrastructure

Verified configuration only; anything not confirmed by reading a config file is marked **unverified**. See [ADR 0002](docs/decisions/0002-partial-service-implementation.md) for why this list is uneven across services.

## Runtime & process architecture

- Each backend service is a standalone Node 20 process (Fastify). No shared process, no monorepo build step ties them together at runtime — they only share the `@nexus/shared` npm package and the Postgres/Redis/Kafka connections.
- The frontend is a static SPA (Vite build) served by nginx in its own container — entirely separate from the backend's nginx gateway (`frontend/nginx.conf` vs `backend/infrastructure/nginx/nginx.conf`, two different files, two different purposes: one serves static assets + SPA fallback, the other reverse-proxies to backend services).

## Containers & orchestration

| Layer | Defined in | Covers |
|---|---|---|
| Local dev (compose) | `backend/docker-compose.yml` | postgres, redis, zookeeper, kafka, **auth-service, user-service, chat-service, call-signaling-service**, nginx `api-gateway` |
| Local dev (frontend) | `frontend/docker-compose.yml` | Single `app` container (nginx serving the Vite build); has commented-out placeholder `api`/`db` services not wired to anything real |
| Kubernetes | `backend/infrastructure/kubernetes/` | `namespace.yaml` (ns `nexus`), `configmap.yaml` + inline `Secret` (dev-placeholder values, e.g. `POSTGRES_PASSWORD: "change-me-in-production"`), `ingress.yaml` (routes 7 of 9 services), `deployments/auth-service.yaml`, `deployments/chat-service.yaml` **only** |

**Drift to know about:** `ingress.yaml` defines routes for `group-service`, `expense-service`, and `call-history-service` Kubernetes `Service`s that have no corresponding `Deployment` manifest anywhere in the repo — applying the ingress as-is would reference Services that don't exist unless someone adds them. `media-service` and `notification-service` aren't referenced in `ingress.yaml` at all. Dockerfiles exist only for `auth-service`, `user-service`, `chat-service`, `call-signaling-service` — the other 5 services cannot be built into an image with what's in the repo today.

## Data stores

| Store | Image/version | Used for | Notes |
|---|---|---|---|
| PostgreSQL | `postgres:16-alpine` | All durable relational data, single DB `nexus`, single schema (`backend/infrastructure/postgres/init.sql`) | One shared pool per service via `createPostgresClient()` (max 20 conns, `backend/packages/shared/src/database/postgres.ts`). No per-service DB user/schema isolation — ownership is convention only. |
| Redis | `redis:7-alpine`, AOF persistence on | Sessions/refresh tokens, status cache, rate limiting (sliding-window Lua script), typing indicators, call-room snapshots | `group-service` and `media-service` each connect a Redis client that is never actually used after connecting (dead dependency, confirmed by reading both services) |
| Kafka | Confluent `cp-kafka:7.5.0` + `cp-zookeeper:7.5.0` | Async domain events between services (see `backend/packages/shared/src/messaging/topics.ts` for the full topic list and partition/retention config) | `nexus.dlq.*` dead-letter topics are *defined* but no service ever publishes to them — a consumer handler that throws just triggers kafkajs's default retry, there is no DLQ routing implemented |

## Networking

- Local: all containers on one bridge network `nexus-network` (backend compose) — services address each other by container name (`postgres`, `redis`, `kafka`, `auth-service`, ...).
- Gateway: nginx terminates `/api/v1/*` and `/ws/*` paths and reverse-proxies with `Connection: upgrade` only for the two WS paths it knows about (`/ws/chat`, `/ws/signaling`) — see [ARCHITECTURE.md](ARCHITECTURE.md#1-system-topology--verified-localdocker-compose-configuration) for exactly which paths are (and aren't) routed.
- K8s ingress adds TLS (`cert-manager` + `letsencrypt-prod` issuer, unverified whether actually provisioned anywhere) and sets `nginx.ingress.kubernetes.io/websocket-services: "chat-service,call-signaling-service"` + sticky sessions via `upstream-hash-by: $remote_addr` — this sticky-session annotation is the *only* thing standing between the in-memory WebSocket state (see [ARCHITECTURE.md](ARCHITECTURE.md) risk #1) and total breakage under multiple replicas; it does not fix the underlying issue, it just makes single-replica-per-client more likely.

## Environment configuration & secrets

- Full variable reference: [backend/docs/environment.md](backend/docs/environment.md) — do not duplicate that list here, this section only adds what's *not* in that doc.
- **Every service falls back to a hardcoded dev secret if its JWT/DB env var is unset** (e.g. `'access-secret-change-in-production'` in `auth-service/src/config.ts`) — convenient for `npm run dev` without a `.env` file, but means a misconfigured production deploy fails open to a known weak secret rather than crashing. Verify every service's actual required env vars are set before any non-local deployment; don't rely on the fallback being "safe because it looks like a placeholder."
- `backend/.env.example` and the k8s `configmap.yaml`/`Secret` use different placeholder strings for the same purpose (e.g. compose's `dev-access-secret-change-me` vs. code's `access-secret-change-in-production`) — cosmetic inconsistency, not a functional issue, but don't assume one file's placeholder appears in the other.
- `STORAGE_*` (S3) env vars are documented and read into `user-service`'s config but **never used** — no S3 client is ever constructed; avatar "upload" fabricates a URL string instead (see [backend/services/user-service/AGENTS.md](backend/services/user-service/AGENTS.md)).
- `TURN_*` env vars are documented in `environment.md` but **not read by any service** — confirmed no `process.env.TURN_` references anywhere in `call-signaling-service`. WebRTC calls behind symmetric NAT/strict firewalls will fail; only public STUN is configured.

## Logging, metrics, tracing, alerts

- **Logging:** every service uses `pino` via `createLogger()` (`backend/packages/shared/src/utils/logger.ts`), structured JSON in production, pretty-printed in dev if `pino-pretty` is resolvable. Automatic redaction of `password`/`token`/`refreshToken`/`accessToken` fields. `RequestContext`/`createRequestLogger` exist for correlation-ID-scoped child loggers but it is **unverified** whether every route actually attaches one (not confirmed across all 9 services).
- **Metrics:** no metrics library (prometheus client, statsd, etc.) is present in any `package.json`. **Not implemented.**
- **Tracing:** no OpenTelemetry/Jaeger/Zipkin dependency anywhere. Kafka events carry a `correlationId` field in their envelope (`BaseEvent`), which is the only cross-service correlation mechanism that exists, and it's optional (`correlationId?: string`) — **not a distributed tracing system, just an event-envelope field that may be empty.**
- **Alerts:** none configured (no alerting config found; this would live outside the repo in a real deployment anyway, but there's no documentation of where).
- **Health checks:** every one of the 4 deployable services exposes `/health` (checked in their Dockerfile `HEALTHCHECK` and docker-compose `healthcheck:` blocks for the infra containers); the 5 non-deployable services' health-check behavior is unverified since they're never containerized.

## Scaling & failure recovery — current reality, not the README's target state

- **Services are not safely horizontally scalable yet** for `chat-service` and `call-signaling-service` — see [ARCHITECTURE.md](ARCHITECTURE.md) risk #1. Scaling `auth-service`/`user-service` is safe (stateless, Redis/Postgres-backed only).
- **No automatic failure recovery for in-flight calls**: if `call-signaling-service` restarts mid-call, the in-memory `CallRoom` is lost and the DB row is left in `ongoing`/`initiating` forever — nothing reconciles orphaned rows (confirmed: no cron/sweep job exists anywhere in the repo).
- **No circuit breaker / retry / timeout policy** is configured for service-to-service or service-to-datastore calls beyond Postgres pool defaults (`connectionTimeoutMillis: 5000`) and Kafka's own client defaults — a slow dependency will propagate as a slow request, not get isolated.
- **No backup/restore procedure is documented or scripted** anywhere in the repo for Postgres data.

## Known gaps summary

See [ADR 0002](docs/decisions/0002-partial-service-implementation.md) for the deployment-coverage gap, [TESTING.md](TESTING.md) for the test gap, and [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for how these surface as concrete symptoms during development.

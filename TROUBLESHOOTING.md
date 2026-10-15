# Troubleshooting

Common failure modes for this repo, verified against actual config — not a generic troubleshooting checklist.

## Running services locally

Only 4 backend services start via Docker Compose. See [MODULES.md](MODULES.md) for the full deployment-status table.

```bash
cd backend
cp .env.example .env               # edit JWT secrets etc. if needed
docker-compose up -d postgres redis kafka zookeeper
docker-compose up -d auth-service user-service chat-service call-signaling-service
# or just: docker-compose up -d   (brings up everything compose knows about, same 4 services + gateway)
```

To run one of the other 5 services (`media-service`, `group-service`, `expense-service`, `notification-service`, `call-history-service`), there is no compose entry or Dockerfile — run it directly against the already-running shared infra:

```bash
cd backend
npm install
npm run build --workspace=@nexus/shared
npm run dev --workspace=@nexus/group-service   # reads POSTGRES_HOST/REDIS_HOST/KAFKA_BROKERS from your shell env or .env
```

Frontend:

```bash
cd frontend
npm install
npm run dev     # vite dev server on :8080 — see note below about port collision
```

**Port collision note**: the frontend's vite dev server defaults to port 8080 (`frontend/vite.config.ts`), the same port the backend's nginx gateway publishes to the host (`backend/docker-compose.yml`). Running both natively on the same host outside Docker will conflict — either change one, or rely on Docker's network isolation when both run as containers.

## "My service can't reach Postgres/Redis/Kafka"

- Inside Docker Compose, services address infra by container name (`postgres`, `redis`, `kafka:9092`). Outside Docker (running a service with `npm run dev` on the host), you need `localhost` and the **host-mapped** Kafka port: `KAFKA_BROKERS=localhost:29092`, not `9092` — `9092` is only reachable from inside the compose network (`backend/docker-compose.yml`'s `KAFKA_ADVERTISED_LISTENERS` maps `PLAINTEXT_HOST://localhost:29092` specifically for this case). `backend/.env.example` already has this right (`KAFKA_BROKERS=localhost:29092`) — if you copied values from `docker-compose.yml`'s internal env block instead of `.env.example`, this is the likely cause of connection failures.

## "A route I'm calling returns 404 through the gateway but works on the service's own port"

Check `backend/infrastructure/nginx/nginx.conf` — it only proxies `/api/v1/auth`, `/api/v1/users`, `/api/v1/search`, `/api/v1/chats`, `/api/v1/messages`, `/ws/chat`, `/api/v1/calls`, `/ws/signaling`. Group, expense, call-history, notification, and media routes have **no path through the local gateway at all** (verified — not a path you're missing, the config genuinely doesn't route them). Call the service's own port directly for local testing, or add the `location` block to `nginx.conf` as part of your change if you're productionizing that service (see [ADR 0002](docs/decisions/0002-partial-service-implementation.md)).

## "Real-time events (chat message / call status) aren't reaching a connected client"

First check: are sender and recipient connected to the **same process**? If you're running more than one replica of `chat-service` or `call-signaling-service` (or testing with `docker-compose up --scale chat-service=2`), WebSocket state is process-local memory and Redis pub/sub is not actually wired up for fan-out — see [ARCHITECTURE.md](ARCHITECTURE.md) risk #1 for exactly which Kafka-backed paths still work across replicas and which don't. This is not a transient bug to retry around; it's a structural limitation until someone implements real Redis-subscriber-based fan-out.

## "Call `wsUrl` doesn't connect / connects to the wrong host"

`call-signaling-service`'s `/calls/initiate` and `/calls/:id/accept` responses hardcode `ws://localhost:<port>` in the returned `wsUrl` (verified in `signaling.service.ts`/route handlers) — this only works when the client and service are both on `localhost`. It will not work through the nginx gateway, in Docker Compose (service-to-service vs. browser-to-service hostnames differ), or in any deployed environment. This is a known gap, not a config you're missing — fixing it means deriving the public base URL from an env var (e.g. reusing the pattern `frontend`'s `VITE_API_URL` build arg was *meant* to provide, itself currently dead — see [frontend/AGENTS.md](frontend/AGENTS.md)).

## "Frontend hits `localhost:8080` even though I set `VITE_API_URL` at build time"

`frontend/src/lib/api/config.ts` has `const isDevelopment = "true"` — a string literal, always truthy, never actually reading `import.meta.env.VITE_API_URL` or `import.meta.env.DEV`. The Dockerfile's `--build-arg VITE_API_URL` is plumbed through to an `ENV` but nothing in the app code consumes it. This is a real bug, not a misconfiguration on your part — fix requires changing `config.ts` to read the Vite env var, which is out of scope for documentation alone; flag it if you hit it.

## "Group balances look wrong"

`expense-service`'s `GET /groups/:groupId/balances` query (`BALANCES_BY_GROUP`) uses an implicit comma-join between `ledger_entries` and `group_members` with no join predicate, which looks like a cross-join-inflation bug on first read — it was independently verified **not** to inflate output (see [ENGINEERING_RULES.md](ENGINEERING_RULES.md#database-access--established-with-one-bug-to-know) for why the math works out). If balances genuinely look wrong, look first at the split-amount computation in the expense-creation path (equal/exact/percentage) or at whether a user left the group after participating in an expense (they'd drop out of this query's output entirely, since it enumerates current `group_members`), rather than assuming the join is the cause.

## "Avatar upload succeeds (200 OK) but the image never loads"

`user-service`'s `POST /me/avatar` does not actually upload anything to S3 — it reads the file into memory, discards it, and writes a fabricated `https://{bucket}.s3.{region}.amazonaws.com/...` URL to the database. The 200 response is real; the stored URL points at an object that was never created. Confirmed via explicit `// TODO: Implement actual S3 upload` comment in `user.service.ts`.

## "A Kafka consumer is stuck reprocessing the same message forever"

Check whether the handler lets an internal failure (e.g. SMTP send in `notification-service`) escape uncaught — `KafkaClient.subscribe()`'s `eachMessage` wrapper re-throws on handler failure to "trigger retry," but no DLQ routing is implemented anywhere (`nexus.dlq.*` topics are defined, unused). This will look like a hung or slow-draining consumer group, not a crash. See [ENGINEERING_RULES.md](ENGINEERING_RULES.md#concurrency-retries-idempotency--proposed-improvement-area).

## "`npm test` says nothing to test / does nothing"

Expected — see [TESTING.md](TESTING.md). There are no test files in 5 of 9 services that declare a jest script, and no `jest.config.js` anywhere in the backend. This is not a broken local setup.

## "`npm run lint` in `backend/` doesn't seem to do anything"

There is no `.eslintrc*` file anywhere under `backend/` despite `eslint`/`prettier` being root devDependencies and a `lint` script existing — verify whether this is intentional before assuming your terminal output is wrong.

## Logs to check first

Every service logs structured JSON via pino (or pretty-printed in dev). Look for `service: "<name>"` and `err`/`error` fields. Correlation across services is best-effort only via the optional `correlationId` field on Kafka event envelopes — don't expect a trace ID to always be present (see [INFRASTRUCTURE.md](INFRASTRUCTURE.md#logging-metrics-tracing-alerts)).

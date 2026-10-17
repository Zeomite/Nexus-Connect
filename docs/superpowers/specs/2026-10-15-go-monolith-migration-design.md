# Design Spec: Nexus Connect Backend — TypeScript Microservices → Go Modular Monolith

- **Status:** Approved (foundation scope), ready for implementation planning
- **Date:** 2026-10-15
- **Audience:** whoever implements this (human or agent), and future contributors deciding how to extend the Go backend

## 1. Context

The current backend (documented in full in the root [AGENTS.md](../../../AGENTS.md)/[MODULES.md](../../../MODULES.md)/[ARCHITECTURE.md](../../../ARCHITECTURE.md)) is 9 independent TypeScript/Fastify microservices (`auth`, `user`, `chat`, `call-signaling`, `media`, `group`, `expense`, `notification`, `call-history`) plus a shared `@nexus/shared` npm package, communicating over HTTP (via an nginx gateway) and Kafka, with Postgres and Redis as shared data stores. Only 4 of the 9 services are actually deployable today; the rest are scaffolding. Zero automated tests exist anywhere.

**Goal:** rewrite the backend in Go as a **single monolithic binary** that preserves the same domain module boundaries — each current microservice becomes a Go package with its own "facade" (a `Service` interface other modules call in-process) instead of a separately deployed process. The frontend's HTTP/WebSocket contract is preserved exactly, so `frontend/` requires no changes.

**This spec is too large to implement as one plan.** It covers the **whole program's shape and decisions**, but only the **Foundation** (§4) is being handed to `writing-plans` next. Each of the 9 domain modules gets its own brainstorm-lite pass and spec addendum before it's implemented, reusing everything decided here. See §3 for the build order.

## 2. Decisions made during brainstorming

These were explicitly chosen by the project owner and are not open for re-litigation during implementation — if one turns out to be wrong, that's a new brainstorming conversation, not a silent deviation.

| Decision | Choice | Rationale |
|---|---|---|
| **Port fidelity** | Faithful port first. Known bugs/stubs (the `user-service` email leak via `GET /:userId`, the fake S3 avatar upload, `call-signaling-service`'s empty `CALL_ANSWERED`/`CALL_DECLINED`/`CALL_ENDED` consumer branches, etc. — full list in each service's `AGENTS.md`) are ported as-is, each marked with a `// TODO(gap): <short description>, see backend/services/<name>/AGENTS.md` comment. Fixing them is a dedicated follow-up pass after the whole backend is ported, not during. | Keeps each module's scope bounded and comparable to the original; avoids scope creep turning a port into a redesign. |
| **Async/eventing** | Drop Kafka (and Zookeeper) entirely. Replace with an in-process typed event bus (`internal/platform/events`) for business events, and goroutine worker pools for async jobs (e.g. email sending) in place of Kafka consumer groups. | In a monolith, every module runs in every process/replica, so cross-process event delivery for business logic is unnecessary — the only thing that genuinely needs cross-replica coordination is WebSocket delivery (see next row). Removes an entire infra dependency (Kafka+Zookeeper) for local dev and deployment. |
| **WebSocket horizontal scaling** | Build real Redis-pub/sub-backed fan-out (`internal/platform/realtime`) from day one — fixing the original's dead-code gap (Redis was written to but never subscribed to). | Explicitly chosen over "single instance only," which was the lower-effort recommended default — the project owner wants multi-replica correctness from the start rather than as a later retrofit. |
| **media-service scope** | Port the same **non-functional scaffolding** (mediasoup-equivalent Worker/Router/Transport structs with no produce/connect/consume), using Pion (Go's WebRTC library) for the pieces that are genuinely real today. Not deferred, not built-for-real. | Explicitly chosen over deferring it entirely or building a working SFU — keeps structural parity (9 modules ported, not 8) without taking on a full WebRTC SFU implementation as part of a language port. |
| **DI framework** | Uber `fx`. Each domain package exports one `fx.Module(...)` bundling its providers; `main.go` composes all modules and calls `.Run()`. `OnStart`/`OnStop` lifecycle hooks replace the current per-service manual SIGTERM-triggered shutdown code. | Explicitly chosen over hand-written wiring (simpler, lower-dependency) and over Google `wire` (compile-time codegen, no lifecycle hooks) — the project owner wants `fx`'s module-as-first-class-concept and built-in lifecycle management specifically. |

## 3. Program decomposition & build order

Each numbered item below is its own future brainstorm-lite → spec addendum → `writing-plans` → implementation cycle, built on top of the Foundation. Order follows dependency direction (auth before everything; thin/stub services deprioritized; media last since it's non-functional either way):

0. **Foundation** (this spec, §4) — implemented next.
1. `auth` — registration, login, JWT issue/refresh, email verification, password reset.
2. `user` — profile, status, search, avatar.
3. `chat` — messages, WebSocket, the first consumer of `internal/platform/realtime`.
4. `call-signaling` — WebRTC signaling, call state machine, second consumer of `realtime`.
5. `group` — group CRUD, membership, roles.
6. `expense` — splits, ledger, settlements, balances.
7. `notification` — email sending, consumes events from `auth`/`call-signaling` via the in-process bus.
8. `call-history` — read API over events consumed from `call-signaling`.
9. `media` — ported scaffolding, last.

Each module's own spec will restate its specific routes/invariants/known-gaps (already fully catalogued in that service's existing `AGENTS.md`) translated into this Go architecture — this spec does not re-derive that detail.

## 4. Foundation design (in scope for the next implementation plan)

### 4.1 Repository shape

One Go module. Two top-level trees under a new `backend-go/` directory (kept alongside the existing `backend/` during the transition so the old system stays runnable until cutover — see §6):

```
backend-go/
  cmd/server/main.go        — fx.New(platform.Module, auth.Module, ...).Run()
  internal/platform/        — shared foundation (this spec)
    config/                 — env var loading into a typed Config struct, no viper
    db/                     — pgxpool wrapper: Query/QueryOne/Transaction helpers
    cache/                  — go-redis wrapper: same operation surface as redis.ts, + SessionKeys-equivalent key helpers
    events/                 — in-process typed pub/sub bus, fire-and-forget Publish()
    realtime/               — Redis-pub/sub-backed cross-replica fan-out (the new, real piece)
    httpserver/             — chi router setup: CORS, security headers, panic recovery, error-mapping middleware
    auth/                   — JWT sign/verify, bcrypt, auth middleware, public/protected router-group split
    errors/                 — AppError-equivalent taxonomy + HTTP response mapping
    logger/                 — slog-based structured logger with redaction
    ratelimit/              — ported Redis Lua sliding-window limiter
    validate/               — go-playground/validator wiring + custom rules (e.g. password strength)
    idgen/                  — UUID / unique-10-digit-number / short-ID helpers
    migrations/             — golang-migrate-compatible versioned .sql files, seeded from backend/infrastructure/postgres/init.sql
  internal/<domain>/        — one per module, added module-by-module per §3 (NOT built in the Foundation step)
```

### 4.2 Library choices

| Concern | Library | Notes |
|---|---|---|
| Postgres | `jackc/pgx/v5` + `pgxpool` | Direct pool access, no `database/sql` compatibility shim |
| Redis | `redis/go-redis/v9` | |
| HTTP routing | `go-chi/chi/v5` | stdlib `net/http`-compatible, pairs cleanly with `fx` |
| WebSocket | `coder/websocket` (actively-maintained fork of `nhooyr.io/websocket`) | |
| DI | `go.uber.org/fx` | |
| JWT | `golang-jwt/jwt/v5` | |
| Password hashing | `golang.org/x/crypto/bcrypt` | Same 12 rounds as today |
| Validation | `go-playground/validator/v10` | Struct tags for most rules; multi-rule checks like password strength become small registered custom validators |
| Logging | `log/slog` (stdlib) | JSON handler, redact `password`/`token`/`refreshToken`/`accessToken` keys to match current pino config |
| Migrations | `golang-migrate/migrate` | New tooling; schema itself (tables/columns) is an exact copy of `init.sql` — explicit sign-off already given in brainstorming (§2) to treat this as in-scope tooling, not a fidelity deviation |

### 4.3 fx module convention

```go
// internal/<domain>/module.go
var Module = fx.Module("<domain>",
    fx.Provide(NewStore, NewService, NewHandler),
    fx.Invoke(RegisterRoutes),       // mounts this module's routes on the shared chi.Router
    fx.Invoke(RegisterSubscriptions), // wires this module's event-bus subscriptions, if any
)
```

`RegisterRoutes(r chi.Router, h *Handler)` and `RegisterSubscriptions(bus *events.Bus, svc *Service)` are ordinary functions `fx.Invoke` calls with their declared dependencies resolved from the graph — no module reaches into another module's internals; everything crosses a boundary through an exported `Service` interface (the "facade" from the original request) or through `events.Bus`.

### 4.4 Error handling contract

Every module returns `*errors.AppError` (or a plain `error`, treated as an unexpected 500) from its `Service` methods. One `chi` middleware in `platform/httpserver` recovers panics and maps the returned error to:

```json
{"error": {"code": "NOT_FOUND", "message": "Chat not found", "details": {}}}
```

— byte-for-byte the same envelope `backend/packages/shared/src/utils/errors.ts`'s `AppError.toJSON()` produces today. This is the single most important compatibility constraint: `frontend/src/lib/api/client.ts`'s `ApiRequestError` parsing must keep working unmodified.

### 4.5 Data flow example (illustrates what the Foundation must support — not implemented until the `chat` module's own cycle)

1. `POST /api/v1/messages` → `chi` → `chat.Handler` → `chat.Service.SendMessage` → `chat.Store` (via `platform/db`) → `platform/events.Publish(MessageSent{...})`.
2. The bus dispatches in-process to any subscriber running in **this replica**.
3. `chat`'s WebSocket layer checks its local connection map first; if the recipient isn't connected to this replica, it publishes to `platform/realtime` (Redis channel), and — unlike the original — every replica's subscriber loop has a real handler that delivers to its own local connections.

### 4.6 Testing approach

Unlike the original (zero tests anywhere), the Foundation is built test-first:

- Table-driven unit tests per `platform/*` package, with `fx`'s constructor-injection style making fakes trivial to substitute (e.g. a fake `cache.Client` for rate-limiter tests).
- At least one `testcontainers-go`-backed integration test proving `platform/db` + a real `golang-migrate` run against a throwaway Postgres container actually works end-to-end.
- `superpowers:test-driven-development` governs the implementation itself — tests are written alongside, not after.

### 4.7 Local dev / deployment

- `backend-go/Dockerfile` (multi-stage, mirroring the pattern in `backend/services/auth-service/Dockerfile`) and a new service entry in a `backend-go/docker-compose.yml` alongside Postgres and Redis containers. Kafka and Zookeeper containers are dropped (nothing will consume them).
- A `migrate` subcommand (or separate small `cmd/migrate/main.go`) applies `golang-migrate` migrations — replacing the old ad hoc `auth-service`-only migration runner with one tool used by the whole monolith.

## 5. Definition of done — Foundation sub-project only

- [ ] `backend-go/go.mod` builds via `go build ./...` with no domain modules yet — just `platform/*` and a `main.go` that boots successfully.
- [ ] `/health` returns 200 once the fx app starts; `SIGTERM` triggers `OnStop` hooks closing the Postgres pool, Redis client, and HTTP server in a defined order (no goroutine leaks — verified, not assumed).
- [ ] `platform/db`, `platform/cache`, `platform/events`, `platform/realtime`, `platform/httpserver`, `platform/auth`, `platform/errors`, `platform/logger`, `platform/ratelimit`, `platform/validate`, `platform/idgen` all exist, are unit-tested, and are wired into `main.go` via `fx.Provide`.
- [ ] `platform/realtime`'s Redis-pub/sub fan-out is proven with a test simulating two "replicas" (two bus instances sharing a Redis container) — this is the one piece of genuinely new behavior relative to the original, so it gets a real test, not just a unit test of the plumbing.
- [ ] `golang-migrate` migration files exist, mirroring `backend/infrastructure/postgres/init.sql` table-for-table, and an integration test applies them against a real (test-container) Postgres.
- [ ] `backend-go/Dockerfile` + docker-compose entry; `docker-compose up` brings up Postgres + Redis + the new Go binary, health check passes.
- [ ] No domain module (`auth`, `user`, etc.) is implemented yet — the Foundation's only HTTP surface is `/health`. This is deliberate; implementing a domain module is explicitly out of scope for this plan.

## 6. Explicitly out of scope for this spec (recorded, not forgotten)

- Any of the 9 domain modules' actual business logic, routes, or data — each gets its own cycle per §3.
- Decommissioning the existing `backend/` TypeScript services — they keep running until the Go monolith has reached parity module-by-module. Cutover strategy (big-bang vs. per-route nginx redirect to the new binary) is a decision for when enough modules are ported to make it concrete, not now.
- Fixing any of the known bugs/gaps catalogued in the existing service `AGENTS.md` files — faithful-port-first per §2.
- A real WebRTC SFU for `media-service` — scaffolding only, per §2.
- Frontend changes of any kind.

## 7. Recorded risks / trade-offs (not oversights — explicitly accepted during brainstorming)

- **No durability for the in-process event bus.** If the process crashes between an HTTP response and an async side-effect completing (e.g. a queued email), that side-effect is lost — no outbox, no replay. This is an accepted consequence of dropping Kafka for an in-process bus; revisit only if a specific flow turns out to need durability.
- **`fx`'s dependency graph is resolved via reflection at runtime.** A wiring mistake (missing provider, cyclic dependency) surfaces when the app boots, not at compile time. Accepted trade-off of choosing `fx` over `wire`.
- **The old microservices' schema ownership was convention-only** (one shared Postgres database/schema, no DB-level isolation per service). The Go monolith inherits the same single-schema model — this spec does not introduce per-module schema isolation, since nothing about the language port requires it and it's a separable future decision.

## 8. Next steps

1. Spec self-review (below).
2. Project owner reviews this file.
3. Invoke `superpowers:writing-plans` for the **Foundation** implementation plan only (§4–§5). Each subsequent module (§3, items 1–9) gets its own short brainstorm pass before its own plan — not bundled into one giant plan.

---

### Spec self-review

- **Placeholders:** none — every section has concrete content, no TBDs.
- **Internal consistency:** §2's "drop Kafka" and §4.1's `internal/platform/realtime` are consistent (realtime is Redis-based, not Kafka-based); §2's "faithful port" is consistent with §6 explicitly deferring bug fixes rather than silently fixing things in the Foundation (the Foundation has no domain logic to have bugs in yet, so this mostly matters for the future module cycles — noted there).
- **Scope:** Foundation-only, as required — confirmed narrow enough for one implementation plan (§5's DoD has no domain-module items).
- **Ambiguity:** "faithful port" could be read as applying to the Foundation's own tooling choices (migrations, DI framework) — §2's table and the golang-migrate callout in §4.2 make explicit that tooling/infra choices are not constrained by fidelity, only observable business behavior of the 9 domain modules is.

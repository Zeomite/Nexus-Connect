# Module Inventory

Verified inventory of every meaningful module in Nexus Connect. "Deployment status" and "Tests" columns are load-bearing — see [ADR 0002](docs/decisions/0002-partial-service-implementation.md) for why they differ so much between modules. Each module links to its own `AGENTS.md` for full detail.

## Backend — `backend/`

npm workspaces root (`backend/package.json`, workspaces `services/*` + `packages/*`). Not joined with the frontend in a single workspace — `frontend/` is an entirely separate npm project. See [backend/AGENTS.md](backend/AGENTS.md).

### Shared library

| Module | [backend/packages/shared/AGENTS.md](backend/packages/shared/AGENTS.md) |
|---|---|
| Responsibility | DB (Postgres pool, query constants), Redis client, Kafka client + topic registry, JWT/bcrypt/crypto helpers, Fastify auth + rate-limit plugins, typed domain events, error classes, logger (pino) |
| Entry point | `backend/packages/shared/src/index.ts` (barrel export) |
| Consumed by | Every service below, via `@nexus/shared: "*"` workspace dependency |
| DB entities | Owns no tables itself; defines the `PostgresClient` wrapper + per-domain query constants used by all services |
| Tests | None |

### Services (`backend/services/*`)

| Service | Port | Responsibility | Deployment status | Key tables | Kafka (produces → consumes) | Tests | Docs |
|---|---|---|---|---|---|---|---|
| **auth-service** | 3001 | Registration, login, 6-digit-code email verification, 3-step password reset, JWT issue/refresh (Redis-backed, rotating) | ✅ Dockerfile + compose + k8s Deployment | `users` | `nexus.user.events` → *(none)* | 0 tests (jest configured, no test files) | [AGENTS.md](backend/services/auth-service/AGENTS.md) |
| **user-service** | 3002 | Profile CRUD, status (online/offline/busy/away/do_not_disturb) with Redis-cache-over-Postgres, search by unique-number/name, avatar "upload" | ✅ Dockerfile + compose + k8s Deployment | `users` | `nexus.user.events`, `nexus.user.status` → *(none)* | 0 tests | [AGENTS.md](backend/services/user-service/AGENTS.md) |
| **chat-service** | 3003 | 1:1 + group chat, messages, read receipts, typing indicators, WebSocket (`/ws/chat`) | ✅ Dockerfile + compose + k8s Deployment | `chats`, `chat_participants`, `messages` | `nexus.chat.events`, `nexus.chat.messages` → same topics (self-consumes for local fan-out) | 0 tests | [AGENTS.md](backend/services/chat-service/AGENTS.md) |
| **call-signaling-service** | 3004 | WebRTC signaling (offer/answer/ICE), call state machine, WebSocket (`/ws/signaling`, `/ws/notifications`) | ✅ Dockerfile + compose + k8s Deployment | `calls` | `nexus.call.events`, `nexus.call.signaling` → same topics (`call.incoming` handled; answered/declined/ended consumer branches are empty stubs) | 0 tests | [AGENTS.md](backend/services/call-signaling-service/AGENTS.md) |
| **media-service** | 3005 | mediasoup SFU: real Workers/Routers/WebRtcTransports; **no `produce`/`connect`/`consume` routes exist**, so media never actually flows; **no auth plugin registered** (routes unauthenticated) | ❌ No Dockerfile, not in compose, no k8s manifest | *(none — doesn't touch Postgres for its own state)* | *(none)* | 0 tests (jest configured, no files) | [AGENTS.md](backend/services/media-service/AGENTS.md) |
| **group-service** | 3006 | Group CRUD, membership, owner/admin/member role permission checks (actually enforced) | ❌ No Dockerfile, not in compose, no k8s manifest (but referenced in `ingress.yaml`) | `groups`, `group_members` | `nexus.group.events` → *(none)* | 0 tests | [AGENTS.md](backend/services/group-service/AGENTS.md) |
| **expense-service** | 3007 | Expense creation (equal/exact/percentage split, all three computed correctly), ledger entries, settlements, group balances | ❌ No Dockerfile, not in compose, no k8s manifest (but referenced in `ingress.yaml`) | `expenses`, `expense_splits`, `ledger_entries` | `nexus.expense.events` → *(none)* | 0 tests — the balances query uses a fragile implicit-join style that's correct today but easy to misread as buggy (see [ENGINEERING_RULES.md](ENGINEERING_RULES.md)) | [AGENTS.md](backend/services/expense-service/AGENTS.md) |
| **notification-service** | 3008 | Email send via nodemailer/SMTP from Kafka-queued templates; missed-call email | ❌ No Dockerfile, not in compose, no k8s manifest | *(reads `users` directly — cross-service DB read)* | consumes `nexus.notifications`, `nexus.notifications.email`, `nexus.call.events`; push (`nexus.notifications.push`) defined but never implemented | 0 tests | [AGENTS.md](backend/services/notification-service/AGENTS.md) |
| **call-history-service** | 3009 | Call log read API, built from consumed call events | ❌ No Dockerfile, not in compose, no k8s manifest (but referenced in `ingress.yaml`) | `call_history` | consumes `nexus.call.events` | 0 tests | [AGENTS.md](backend/services/call-history-service/AGENTS.md) |

### Infrastructure config (not code modules, but part of the inventory)

| Item | Location | Status |
|---|---|---|
| Postgres schema | `backend/infrastructure/postgres/init.sql` | Single file, all tables for all 9 services, applied at container init |
| API gateway (local) | `backend/infrastructure/nginx/nginx.conf` | Routes only to auth/user/chat/call-signaling — matches docker-compose, not ingress.yaml |
| K8s manifests | `backend/infrastructure/kubernetes/` | `namespace.yaml`, `configmap.yaml` (+ inline Secret), `ingress.yaml` (7 services routed), `deployments/` (only auth-service, chat-service defined — **drift from ingress.yaml**, see [INFRASTRUCTURE.md](INFRASTRUCTURE.md)) |

## Frontend — `frontend/`

Independent npm project (Vite + React 18 + TypeScript + shadcn/ui + TanStack Query + React Router). See [frontend/AGENTS.md](frontend/AGENTS.md).

| Area | Key files | Status |
|---|---|---|
| Routing & shell | `src/App.tsx`, `src/layouts/MainLayout.tsx` | Full route table implemented, real guards |
| Auth | `src/contexts/AuthContext.tsx`, `src/lib/api/auth.ts` | Real; tokens in `localStorage` (XSS-exposed, see [SECURITY.md](SECURITY.md)) |
| API client | `src/lib/api/client.ts`, `config.ts` | Real fetch wrapper with single-flight refresh-on-401; **`config.ts` has a hardcoded `isDevelopment="true"` string bug** — `VITE_API_URL` build arg is dead, prod builds still target `localhost:8080` |
| WebSockets | `src/lib/websocket/{Chat,Notification,Signaling}WebSocket.ts` | Three independent implementations (no shared base class); real reconnect/backoff logic |
| Calling | `src/pages/Call.tsx`, `IncomingCallModal.tsx` | Real mesh P2P WebRTC via `call-signaling-service`; **never talks to `media-service`** — the SFU is architecturally orphaned from the client today |
| Chats | `src/pages/Chats.tsx` | Real, paginated, optimistic-ish send |
| Contacts | `src/pages/Contacts.tsx` | Real search + group creation; no expense/balance UI despite backend types existing |
| Call History | `src/pages/CallHistory.tsx` | Real list; search box is cosmetic (doesn't filter) |
| Profile | `src/pages/Profile.tsx` | Mostly real; "status message" field is local-only, not persisted |
| Settings | `src/pages/Settings.tsx` | Fully static mock — no state, no persistence, no handlers |
| Tests | `src/test/` | One trivial placeholder test (`expect(true).toBe(true)`) |

## Cross-cutting facts that apply to every module

- **No automated tests exist anywhere in the repo** except one placeholder frontend test. See [TESTING.md](TESTING.md).
- **No CI** (`.github/` does not exist). See [INFRASTRUCTURE.md](INFRASTRUCTURE.md).
- **Single git commit** — no history to mine for rationale; this harness's ADRs are the first recorded decisions.
- Every service falls back to a hardcoded dev JWT/DB secret if its env var is unset — convenient locally, a real risk if ever deployed with defaults. See [SECURITY.md](SECURITY.md).

# Architecture

Nexus Connect is a microservices-based real-time communication platform: chat, WebRTC calling, group expense-splitting. Backend: 9 independent Fastify/TypeScript services behind an nginx gateway, sharing Postgres/Redis/Kafka. Frontend: a separate Vite/React SPA. See [MODULES.md](MODULES.md) for the per-module inventory this document assumes.

Every diagram below is marked **Verified** (confirmed by reading the code) or **Target** (described in `backend/README.md` but not confirmed, or confirmed *not* yet true). Don't treat a Target diagram as current behavior.

## 1. System topology — Verified, local/docker-compose configuration

```mermaid
flowchart TB
    FE["Frontend SPA\n(Vite/React, separate project)"]
    GW["nginx API Gateway\n:8080"]

    subgraph deployable["Deployable today (Dockerfile + compose + k8s)"]
        AUTH["auth-service :3001"]
        USER["user-service :3002"]
        CHAT["chat-service :3003"]
        SIG["call-signaling-service :3004"]
    end

    subgraph scaffolded["Source exists, not containerized/deployed (ADR 0002)"]
        MEDIA["media-service :3005"]
        GROUP["group-service :3006"]
        EXP["expense-service :3007"]
        NOTIF["notification-service :3008"]
        HIST["call-history-service :3009"]
    end

    PG[(PostgreSQL\none shared DB)]
    REDIS[(Redis)]
    KAFKA[(Kafka)]

    FE -->|HTTPS + WSS| GW
    GW --> AUTH & USER & CHAT & SIG
    FE -.->|"direct, bypasses gateway\n(dev only, no route exists)"| GROUP
    FE -.-> EXP

    AUTH & USER & CHAT & SIG & MEDIA & GROUP & EXP & NOTIF & HIST --> PG
    AUTH & USER & CHAT & SIG & GROUP & MEDIA --> REDIS
    AUTH & USER & CHAT & SIG & GROUP & EXP & NOTIF & HIST --> KAFKA
```

`nginx.conf` only proxies `/api/v1/auth`, `/api/v1/users`, `/api/v1/search`, `/api/v1/chats`, `/api/v1/messages`, `/ws/chat`, `/api/v1/calls`, `/ws/signaling` — group-service and expense-service have no path through the local gateway at all today; reaching them requires calling their ports directly. `media-service`, `notification-service`, `call-history-service` aren't started by `docker-compose up` at all (not in `backend/docker-compose.yml`).

## 2. Auth flow — Verified

```mermaid
sequenceDiagram
    participant C as Client
    participant A as auth-service
    participant R as Redis
    participant PG as Postgres
    participant K as Kafka

    C->>A: POST /auth/register {email, password, displayName}
    A->>PG: INSERT user (unique_number retried up to 10x)
    A->>K: publish user.registered (nexus.user.events)
    A->>R: cache 6-digit verification code (24h TTL)
    A-->>C: 201 {userId, uniqueNumber}
    Note over A: email send is fire-and-forget;<br/>SMTP failure is swallowed, caller never learns

    C->>A: POST /auth/verify-email {email, code}
    A->>R: check code
    A->>PG: UPDATE users SET email_verified=true
    A->>K: publish user.email_verified

    C->>A: POST /auth/login {email, password}
    A->>PG: SELECT + bcrypt.compare
    A->>R: store refresh token (session key)
    A-->>C: 200 {accessToken (15m), refreshToken (7d)}

    C->>A: POST /auth/refresh {refreshToken}
    A->>R: verify + rotate (delete old, store new)
    A-->>C: 200 {new accessToken, new refreshToken}
```

Password reset is a **3-step flow** (`forgot-password` → `verify-reset-code` → `update-password`), all 6-digit-code based like email verification — not the token-link flow `backend/docs/api-contracts.md` currently documents, and not a 2-step flow. The frontend (`src/lib/api/auth.ts`) already calls the real 3-step endpoints; the written docs are what's behind. **Known gap:** changing a password does not revoke existing refresh tokens (explicit comment in `auth.service.ts`).

## 3. Real-time chat delivery — Verified, including the scaling limitation

```mermaid
sequenceDiagram
    participant S as Sender (WS)
    participant CS as chat-service (process A)
    participant PG as Postgres
    participant K as Kafka
    participant CS2 as chat-service (process B)
    participant R as Recipient (WS, connected to process B)

    S->>CS: ws send {type: message} (implied via POST /messages)
    CS->>PG: INSERT message
    CS->>K: publish chat.message_sent (nexus.chat.messages)
    CS->>CS: wsManager.sendToUser() — local Map lookup only
    Note over CS,R: Sender and recipient on the SAME process: delivered instantly.<br/>On DIFFERENT processes (process B): CS's Redis publish is never subscribed to by anyone.
    CS2->>K: consume chat.message_sent (its own consumer group)
    CS2->>R: delivered via local wsManager — THIS is the actual cross-instance path,<br/>not Redis pub/sub
```

**Critical invariant to know before changing this code:** `WebSocketManager` tracks connections in an in-process `Map`. It also writes connection membership to Redis (`SessionKeys.userConnections`) and calls `redis.publish(...)`, but **nothing in chat-service subscribes to those Redis channels** — the publish is a dead write. The actual (and only) cross-instance delivery path is the Kafka consumer re-pushing through each process's own local `wsManager`. This works for message events (because they're already published to Kafka for persistence) but **not** for anything that isn't also a Kafka event (e.g. a bare `typing:start`, which only exists in-memory and will not reach a user connected to a different replica). `call-signaling-service` has the same in-memory-only room state with an even smaller safety net: `CALL_ANSWERED`/`CALL_DECLINED`/`CALL_ENDED` Kafka consumer branches are empty stubs, so a second replica never learns a call ended on another instance. **Running more than one replica of `chat-service` or `call-signaling-service` today will silently drop some real-time events** — this contradicts `backend/README.md`'s scaling section, which describes Redis pub/sub as the cross-instance mechanism.

## 4. WebRTC call flow — Verified

```mermaid
sequenceDiagram
    participant Caller
    participant SIG as call-signaling-service
    participant Callee

    Caller->>SIG: POST /calls/initiate {participantIds, type}
    SIG->>SIG: create in-memory CallRoom + DB row (status=initiating)
    SIG-->>Caller: {callId, roomId, wsUrl}
    Note over SIG: wsUrl is hardcoded ws://localhost:<port> —<br/>broken through the nginx gateway or in any deployed env
    SIG->>Callee: push call.incoming over /ws/notifications (separate socket from signaling)
    Callee->>SIG: POST /calls/{id}/accept
    SIG-->>Callee: {wsUrl}
    Caller->>SIG: WS connect /ws/signaling
    Callee->>SIG: WS connect /ws/signaling
    Caller->>SIG: offer (SDP)
    SIG->>Callee: call:offer
    Callee->>SIG: answer (SDP)
    SIG->>Caller: call:answer
    Caller->>SIG: ice-candidate (relayed both ways)
    Caller-->>Callee: Peer-to-peer media (mesh WebRTC, browser getUserMedia/RTCPeerConnection)
```

The frontend does **pure mesh P2P WebRTC** and never calls `media-service`. `media-service`'s mediasoup Workers/Routers/Transports are real, but there are no `produce`/`connect`/`consume` routes, so even if the frontend called it, media could not flow end-to-end yet. For a 1:1 call the mesh works; for `isGroupCall`, the client loops participants for offer/ICE but this path is unverified at scale (built/exercised for 1:1). TURN env vars (`TURN_URL` etc.) are documented in `backend/docs/environment.md` but never read by any service — only public STUN is configured, so calls behind symmetric NAT will fail.

## 5. Expense-splitting data flow — Verified

```mermaid
flowchart LR
    A["POST /expenses\n{splitType: equal|exact|percentage}"] --> B["expense-service:\nverify group membership"]
    B --> C[("expenses")]
    B --> D[("expense_splits\n(one row per participant,\namount computed per splitType)")]
    B --> E[("ledger_entries\n(one row per non-payer split)")]
    B --> F["Kafka: expense.created"]
    G["GET /groups/:id/balances"] --> H{{"ledger_entries × group_members,\nimplicit comma-join, no predicate\nbetween the two tables"}}
    H --> I["Correct output today — GROUP BY user_id\npartitions back to 1 row per member,\nthanks to group_members' PK.\nFragile style, not a live bug."]
```

Split computation (equal/exact/percentage) and the balances query's actual output are both correct, verified by independently simulating the query's row-by-row semantics. The balances query's comma-join style is still worth hardening — see [ENGINEERING_RULES.md](ENGINEERING_RULES.md#database-access--established-with-one-bug-to-know) for why it's fragile despite being correct today.

## Dependency direction

```mermaid
flowchart LR
    FE["frontend/"] -->|"HTTP + WS, no shared package"| GW[nginx gateway]
    GW --> SVC["backend/services/*"]
    SVC -->|"@nexus/shared (workspace dep)"| SHARED["backend/packages/shared"]
    SHARED --> PG[(Postgres)]
    SHARED --> REDIS[(Redis)]
    SHARED --> KAFKA[(Kafka)]
```

`frontend/` and `backend/` do not share any code or types — the frontend's `src/lib/api/types.ts` is a hand-maintained mirror of the backend's response shapes, not a generated or imported type. Keeping them in sync is a manual responsibility; there is no contract test enforcing it (see [TESTING.md](TESTING.md)).

## Critical invariants

- All inter-service communication is either synchronous HTTP (gateway-routed) or async via Kafka topics defined in `backend/packages/shared/src/messaging/topics.ts` — there is no service-to-service RPC.
- A single Postgres database and schema (`backend/infrastructure/postgres/init.sql`) is shared by all 9 services; each service owns a subset of tables by convention only (no DB-level enforcement, no separate schemas/users per service).
- JWT access/refresh secrets are shared across every service that validates tokens (`@nexus/shared`'s `authPlugin`) — there is no per-service signing key.
- Kafka event publishing is fire-and-forget: `KafkaClient.publish()` catches and logs failures rather than throwing (`backend/packages/shared/src/messaging/kafka.ts`) — callers must not assume an event was delivered just because the HTTP call succeeded.

## Known architectural risks (ranked)

1. **WebSocket/call-room state is process-local memory with no real cross-instance sync** (chat-service, call-signaling-service) — horizontal scaling is not safe today despite docs implying otherwise. See §3.
2. **`media-service` cannot carry real media traffic** (no produce/connect/consume) and has **no authentication plugin registered** — its routes are open to any caller. Do not point untrusted traffic at it.
3. **5 of 9 services have no deployment path** (Dockerfile/compose/k8s) — see [MODULES.md](MODULES.md) and [ADR 0002](docs/decisions/0002-partial-service-implementation.md).
4. **No automated tests anywhere** mean every refactor is unverified by anything but manual testing — see [TESTING.md](TESTING.md).
5. **Hardcoded `ws://localhost` URLs** returned by `call-signaling-service`'s `initiate`/`accept` responses mean calling doesn't work through the gateway or in any deployed environment yet.

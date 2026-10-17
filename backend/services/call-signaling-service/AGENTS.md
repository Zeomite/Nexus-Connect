# call-signaling-service — AGENTS.md

Port 3004. **Deployable**: Dockerfile + docker-compose + k8s Deployment exist. 0 tests.

## Purpose

WebRTC signaling (offer/answer/ICE relay), call state machine, two WebSocket endpoints: `/ws/signaling` (per-call) and `/ws/notifications` (persistent, pushes incoming-call alerts). The frontend talks to this service directly for calling — it never talks to `media-service` (see [../media-service/AGENTS.md](../media-service/AGENTS.md)); calls today are pure mesh P2P WebRTC between browsers.

## Entry point & startup

`src/index.ts` → `src/server.ts`: builds `SignalingManager` (redis+kafka) and `NotificationManager`, starts `CallConsumer`. WS payload capped at 64KB. `package.json`'s `"migrate"` script points at a `src/database/migrate.ts` that **does not exist** — broken script; schema comes entirely from `infrastructure/postgres/init.sql`.

## Routes (`/api/v1/calls`, Bearer-auth'd)

`POST /initiate` (`{participantIds, type, groupId?}`), `/:callId/accept`, `/:callId/decline`, `/:callId/end`, `GET /:callId`, `GET /active`, `GET /incoming` (uses blocking `redis.keys()` — avoid copying this pattern, prefer `SCAN` or a Set), `DELETE /active` (manual stale-call clear). Table: `calls`.

**`initiate`/`accept` responses hardcode `ws://localhost:<port>` as the returned `wsUrl`** — works only when client and service share `localhost`; breaks through the gateway and in any deployed environment. This is the first thing to fix if calling doesn't connect outside pure local dev — see [../../../TROUBLESHOOTING.md](../../../TROUBLESHOOTING.md).

## WebSocket protocol

`/ws/signaling?token&callId`: client→server `offer`/`answer`/`ice-candidate`/`mute`/`video`/`screen-share`/`leave`/`end-call`; server→client `call:joined`/`call:participant_joined`/`call:participant_left`/`call:offer`/`call:answer`/`call:ice_candidate`/`call:media_state_changed`/`call:declined`/`call:ended`/`error`. Close codes 4001 (unauthorized)/4002 (missing callId)/4003 (room full or not found). **Code 4004 is unreachable dead code** — 4003 fires first in every actual failure path.

`/ws/notifications?token`: separate, longer-lived channel pushing `call:incoming`/`call:cancelled` before a client joins a specific call's signaling socket. **Not documented at all in `../../docs/websocket-events.md`** — that doc's sequence diagram implies `call:incoming` arrives over the signaling socket; it actually arrives here.

**Call/room state is 100% in-process memory** (`Map<callId, CallRoom>`). Redis is written (`SessionKeys.callRoom`/`callParticipants`) but never read back — same dead-write pattern as chat-service, worse here because there's no Kafka-consumer fallback: the `CALL_ANSWERED`/`CALL_DECLINED`/`CALL_ENDED` consumer branches in `call.consumer.ts` are **empty stubs** (comment-only, e.g. `// Handle call answered - update room state`). A second replica never learns a call ended on another instance. See [../../../ARCHITECTURE.md](../../../ARCHITECTURE.md) risk #1.

## Business rules / invariants

- State machine: `initiating` → (first `accept`) `ongoing` → `ended`/`cancelled`. **`ringing` is declared in the type and DB CHECK constraint but never actually set by any code path** — dead state, don't rely on it appearing.
- Only the initiator can `end-call` over WS; any participant can `leave`. Room closes when `participants.size === 0`. `maxParticipants = 50` enforced on join.
- One-active-call-per-user is enforced only at `initiate` time (120s Redis TTL key on the *initiator*) — nothing blocks a user from being invited as a *recipient* into two overlapping calls.
- `iceServers` config has public STUN only; `TURN_URL`/`TURN_USERNAME`/`TURN_CREDENTIAL` (documented in `../../docs/environment.md`) are **never read anywhere in this service** — calls behind symmetric NAT/strict firewalls will fail.

## Known limitations

- Restart mid-call orphans the DB row: if the process restarts, the in-memory room is gone; `endCall` would throw `NotFoundError` on a missing room, so the DB row is never transitioned out of `ongoing`/`initiating`. No sweep job reconciles this.
- `clearActiveCall` only fully closes a room if the initiator is the last participant — if others already joined, calling it from the initiator's side clears their own active-call pointer but can leave the room/DB row dangling in an inconsistent state.

## Testing

0 tests. Highest-value first targets: the call state machine transitions and the orphaned-call-on-restart scenario.

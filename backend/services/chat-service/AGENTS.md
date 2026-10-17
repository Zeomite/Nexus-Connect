# chat-service — AGENTS.md

Port 3003. **Deployable**: Dockerfile + docker-compose + k8s Deployment exist. 0 tests.

## Purpose

1:1 and group chat: messages, read receipts, typing indicators. Real-time via WebSocket (`/ws/chat`) backed by Kafka for persistence and (partial) cross-instance delivery.

## Entry point & startup

`src/index.ts` → `src/server.ts`: Postgres pool, Redis (prefix `chat:`), Kafka client+producer, `WebSocketManager`, `ChatConsumer` all built at boot. Registers cors/helmet/sensible/`@fastify/websocket` (1MB payload cap)/swagger; `authPlugin` excludes `/health*`, `/docs*`, `/ws*`. No rate limiting registered. `JWT_ACCESS_SECRET` falls back to a hardcoded dev string if unset.

## HTTP routes (all Bearer-auth'd except health/docs)

`GET/POST /api/v1/chats`, `/chats/direct`, `/chats/group`, `/chats/:chatId`, `/chats/:chatId/participants`, `DELETE /chats/:chatId/leave` (blocked for direct chats); `GET/POST /api/v1/messages`, `/messages/chat/:chatId` (cursor `before`/`after` or offset pagination), `GET/DELETE /messages/:messageId` (soft delete, sender-only), `POST /messages/read`. Tables: `chats`, `chat_participants`, `messages`.

**Direct-chat creation race**: the existence check (`DIRECT_CHAT_EXISTS`) and the insert aren't in the same transaction — two concurrent requests to create the same 1:1 chat can both pass the check and create duplicate direct chats. Low-frequency in practice, but a real gap if you're hardening this path.

## WebSocket protocol (`/ws/chat`)

Client→server: `ping`, `typing:start`, `typing:stop`, `message:read`, `subscribe:chat`, `unsubscribe:chat`. Server→client: `connected`, `pong`, `message:new`, `message:delivered`, `message:read`, `message:deleted`, `typing:start/stop`, `chat:created`, `error`. Heartbeat: 30s ping / 60s timeout → terminate.

**`subscribe:chat`/`unsubscribe:chat` are dead code**: `WebSocketManager` creates a Redis subscriber on subscribe but registers no message handler for it — the subscription is inert. Don't build on the assumption that chat-scoped Redis subscription does anything today.

**Connection state is in-process memory** (`Map<connectionId, WsConnection>`, `Map<userId, Set<connectionId>>`). Redis is written to (`SessionKeys.userConnections`, pub/sub publish) but never read back by anyone — a dead write, not a working fan-out mechanism. The actual cross-instance delivery path is the Kafka consumer (`ChatConsumer`, group `CHAT_SERVICE`, topics `CHAT_EVENTS`+`CHAT_MESSAGES`) re-pushing through each process's own local `wsManager` — meaning **only events that are also published to Kafka survive a cross-instance hop**; a bare in-memory-only signal (nothing currently, but be careful adding one) would not. See [../../../ARCHITECTURE.md](../../../ARCHITECTURE.md) risk #1 before changing anything here, especially before running >1 replica.

WS `handleMessageRead` in `handler.ts` duplicates `MessageService.markAsRead`'s logic with inline SQL instead of calling the service — a maintenance hazard (two places can diverge). Prefer consolidating onto the service method if you touch either.

## Testing

0 tests despite `jest` configured. Highest-value first targets: the direct-chat-creation race, and the Kafka-consumer-as-fanout path (the part of real-time delivery that actually matters for horizontal scaling).

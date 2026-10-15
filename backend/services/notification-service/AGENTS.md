# notification-service — AGENTS.md

Port 3008. **Not deployable**: no Dockerfile, not in `docker-compose.yml`, no k8s manifest. 0 tests. Consumer-only — no HTTP API of its own beyond health.

## Purpose

Kafka-consumer-driven email notifications: generic templated emails from the `nexus.notifications`/`nexus.notifications.email` topics, plus a specific missed-call email triggered from `nexus.call.events`.

## What's real

Consumes `NOTIFICATIONS`, `EMAIL_QUEUE`, `CALL_EVENTS`. `SEND_EMAIL` events do real `{{key}}`-style template substitution and a genuine nodemailer SMTP send using the documented `SMTP_*`/`EMAIL_FROM` env vars (`../../docs/environment.md`). `CALL_MISSED` handling reads the `users` table **directly** (a cross-service DB read — this service queries a table it doesn't own, a coupling smell worth avoiding in new code) to build and send a hardcoded missed-call email.

## Known gaps

- **Push notifications are entirely unimplemented**: `nexus.notifications.push` is defined in `messaging/topics.ts` but this service never subscribes to it — no push provider integration exists anywhere.
- Unhandled Kafka event types inside a subscribed topic are silently dropped (no warning log) — if you add a new event type to a topic this service consumes, confirm you added a handler branch, not just the type definition.
- **`handleMissedCall`'s `sendMail` call is not wrapped in try/catch.** An SMTP failure throws inside the Kafka `eachMessage` handler, which `KafkaClient.subscribe()` re-throws to trigger kafkajs's retry — with no DLQ routing implemented (despite `nexus.dlq.notifications` existing as a defined topic), a persistent SMTP outage becomes an infinite reprocessing loop for that consumer group, not a clean failure. **Fix this before relying on this service under any real load** — wrap the send, log on failure, and either drop or route to the DLQ topic explicitly.

## Before extending

If you implement push notifications, subscribe to `PUSH_QUEUE`/`nexus.notifications.push` following the same consumer-registration pattern already used for `EMAIL_QUEUE`. Fix the uncaught-SMTP-failure issue above in the same change as any work that touches this file, since any new email-sending path will inherit the same infinite-retry risk otherwise. Add the missing Dockerfile/compose/k8s wiring if you're making this service load-bearing, per [ADR 0002](../../../docs/decisions/0002-partial-service-implementation.md).

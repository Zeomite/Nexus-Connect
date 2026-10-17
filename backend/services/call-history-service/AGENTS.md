# call-history-service — AGENTS.md

Port 3009. **Not deployable**: no Dockerfile, not in `docker-compose.yml`, no k8s Deployment (though `ingress.yaml` already routes to it). 0 tests.

## Purpose

Read API over a call log built entirely from consumed Kafka events — this service never receives direct writes from a client, only from `call-signaling-service`'s event stream.

## What's real

Kafka consumer (group `CALL_HISTORY_SERVICE`) on `CALL_EVENTS`, handling `CALL_INITIATED`/`CALL_ENDED`/`CALL_MISSED` to write `call_history` rows. `GET /api/v1/history` (paginated, real `COUNT`) and `GET /api/v1/history/:callId` (undocumented in `../../docs/api-contracts.md`, but implemented) are both real, auth-plugin-protected.

## Known gaps

- `declined` is a documented status value (`../../docs/api-contracts.md`) but **no code path ever writes it** — `call-signaling-service`'s `CALL_DECLINED` Kafka branch would need to exist and this service would need to handle it; today a declined call simply never produces a `call_history` row with that status.
- The "not found" path for `GET /history/:callId` returns a plain `{error: ...}` object rather than using the shared `NotFoundError` convention — inconsistent error contract with the rest of the codebase; fix if you touch this route.
- No Dockerfile/compose entry/test script.

## Before extending

If you wire up `declined` status, the fix spans two services: `call-signaling-service` must actually publish a `CALL_DECLINED` event on decline (check whether it already does — confirm in that service's consumer/producer code before assuming), and this service's consumer must handle it. Don't assume adding a handler here alone is sufficient.

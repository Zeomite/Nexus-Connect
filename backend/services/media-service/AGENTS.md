# media-service — AGENTS.md

Port 3005. **Not deployable**: no Dockerfile, not in `docker-compose.yml`, no k8s manifest. 0 tests. **No authentication plugin registered — every route is open.**

## Purpose (intended vs. actual)

Intended as a mediasoup SFU for scaling group calls beyond mesh P2P. **Actual state: real plumbing, non-functional end-to-end.** `MediaWorkerManager` creates genuine mediasoup Workers, round-robin Routers per room with real codec config (opus/VP8/VP9/H264), and real WebRtcTransports with ICE/DTLS params (`src/workers/`, `config.ts`). `POST /rooms/:id/router` and `POST /rooms/:id/transports` work and return real mediasoup objects.

**What's missing, and why media can never flow today**: there are no `produce`, `connect`, or `consume` routes anywhere in this service. A transport can be created but nothing can ever attach a media track to it. This is not a documentation gap — it's an incomplete feature, confirmed by reading every route file.

## Other known gaps

- Worker `died` event handler only logs — no restart/recovery logic (comment in code admits this).
- Redis client is connected and decorated but never called anywhere after connecting — dead dependency.
- **No `authPlugin` registered** — unlike every other service, routes here accept unauthenticated requests. This is low-risk only because the service isn't reachable through any gateway path today ([INFRASTRUCTURE.md](../../../INFRASTRUCTURE.md)); it becomes a real vulnerability the moment this service is exposed.

## Frontend relationship

The frontend's call flow (`frontend/src/pages/Call.tsx`) never calls this service — it does pure mesh WebRTC through `call-signaling-service` only. Wiring the frontend to use an SFU for group calls would require both finishing `produce`/`connect`/`consume` here **and** a client-side rewrite of the call flow — treat these as one combined project, not two independent tasks.

## Before extending this service

1. Add `authPlugin` first — don't add new functional routes to an unauthenticated service.
2. Implement `produce`/`connect`/`consume` to actually close the SFU loop before building anything on top of it.
3. Add the deployment wiring (Dockerfile, compose entry, k8s manifest) in the same change that makes this service functionally complete — per [ADR 0002](../../../docs/decisions/0002-partial-service-implementation.md).
4. Add tests — there are currently zero, despite `jest` being configured in `package.json`.

# ADR 0002: Partial Service Implementation Is a Known, Permanent-Until-Fixed State

- **Status:** Accepted (documenting current reality, not a target state)
- **Date:** 2026-10-15

## Context

`backend/README.md` describes all 9 microservices as peers with full feature sets. A full-repo code read (see [[../../MODULES.md]]) found this is not the case:

- **Deployable today** (Dockerfile + docker-compose entry + env wiring): `auth-service`, `user-service`, `chat-service`, `call-signaling-service`.
- **Not deployable as-is** (no Dockerfile, not in `backend/docker-compose.yml`, no k8s manifest): `media-service`, `group-service`, `expense-service`, `notification-service`, `call-history-service`. These only run via `npm run dev --workspace=@nexus/<service>` against manually-started shared infra.
- Only `auth-service` and `chat-service` have Kubernetes `Deployment` manifests (`backend/infrastructure/kubernetes/deployments/`), yet `ingress.yaml` routes traffic to `group-service`, `expense-service`, and `call-history-service` Kubernetes Services that are never defined — the ingress config is ahead of the deployment manifests.
- `nginx.conf` (the docker-compose-local gateway) only proxies to the 4 deployable services, which is internally consistent with docker-compose but means the other 5 services have no gateway path even when run manually.
- **Zero automated tests** exist anywhere in the backend (no `*.test.ts` under any service despite 5 of 9 `package.json` files declaring `"test": "jest"`) and the frontend has exactly one trivial placeholder test.

This is not a transient gap caused by a recent regression — it is the state of a greenfield, single-commit codebase where scaffolding (package.json, types, DB schema, docs) was generated ahead of implementation for the newer-domain services (groups/expenses/notifications/media/call-history).

## Decision

Document the gap precisely instead of either (a) hiding it, or (b) describing the target architecture as if it were current reality. Specifically:

- [[../../MODULES.md]] and each affected module's `AGENTS.md` carry a **"Deployment status"** line stating plainly whether the service runs via Docker/K8s or only via `npm run dev`.
- [[../../INFRASTRUCTURE.md]] treats the 4-service docker-compose/nginx/k8s setup as "verified, current" and the other 5 as "source exists, infra wiring does not" rather than listing all 9 uniformly.
- [[../../TESTING.md]] states "no automated tests exist" as a verified fact, not a coverage percentage to be charitable about.
- New work that completes a stubbed service (e.g. wiring a real S3 client for `user-service` avatar upload, adding mediasoup `produce`/`consume` routes to `media-service`, hardening `expense-service`'s fragile-but-correct balances query — see [ENGINEERING_RULES.md](../../ENGINEERING_RULES.md)) should add the missing Dockerfile/compose entry/k8s manifest/tests **as part of the same change**, not as separate deferred work, since the pattern for all four already-deployable services is the reference to copy.

## Consequences

- Agents must not assume a service is runnable in Docker/K8s just because its source and DB schema exist — check [[../../MODULES.md]] first.
- Reviewers should flag any PR that extends a thin service's business logic without also closing its deployment/test gap, to avoid widening the split between "well-supported" and "scaffolding-only" services.

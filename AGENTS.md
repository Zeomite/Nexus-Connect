# AGENTS.md — Nexus Connect

Entry point for any AI agent working in this repo. Read this fully before touching code. It's short on purpose — it points to verified detail docs rather than repeating them; follow the links for anything beyond the load-bearing facts below.

## What this is

A real-time communication platform: chat, WebRTC calling, group expense-splitting. **Two independent projects, not a monorepo**: `backend/` (9 Fastify/TypeScript microservices + a shared npm package, behind an nginx gateway, sharing Postgres/Redis/Kafka) and `frontend/` (Vite/React SPA). They share no code and no npm workspace — see [ARCHITECTURE.md](ARCHITECTURE.md).

**Load-bearing fact before you do anything else**: this is a greenfield, single-commit codebase where scaffolding (types, DB schema, docs) was generated ahead of implementation for several services. 5 of 9 backend services have no Dockerfile/compose entry/k8s manifest, and **zero automated tests exist anywhere** except one placeholder. Don't assume parity across services or trust `backend/README.md`'s feature descriptions at face value — [MODULES.md](MODULES.md) is the verified inventory; [ADR 0002](docs/decisions/0002-partial-service-implementation.md) explains why the gap exists.

## Directory map

```
backend/
  packages/shared/      @nexus/shared — DB/Redis/Kafka clients, auth+rate-limit plugins, errors, types
  services/<name>/      9 independent Fastify services, see MODULES.md for which are deployable
  infrastructure/       postgres init.sql, nginx.conf, k8s manifests (partial — see INFRASTRUCTURE.md)
  docs/                 api-contracts.md, websocket-events.md, environment.md (human-facing, has some drift — see below)
frontend/
  src/pages, contexts, hooks, lib/api, lib/websocket, components
docs/
  decisions/            ADRs for the harness itself and known architectural gaps
  workflows/             step-by-step procedures for common change types
  standards/             how these docs are written and maintained
```

## Documentation map — read the linked doc, don't guess

| Question | Read |
|---|---|
| How is the system structured, what talks to what? | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Is this service/module deployable, tested, what does it own? | [MODULES.md](MODULES.md), then that module's own `AGENTS.md` |
| What infra actually exists (Docker/k8s/nginx/env)? | [INFRASTRUCTURE.md](INFRASTRUCTURE.md) |
| What conventions should my code follow? | [ENGINEERING_RULES.md](ENGINEERING_RULES.md) |
| How do I test this, and what isn't tested? | [TESTING.md](TESTING.md) |
| Auth/authz/secrets rules and known gaps | [SECURITY.md](SECURITY.md) |
| Something's broken locally | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) |
| HTTP/WebSocket contracts, env vars | `backend/docs/api-contracts.md`, `websocket-events.md`, `environment.md` — accurate for the 4 deployable services, corrected-in-place where this harness found drift |
| Why was a harness/architecture decision made? | `docs/decisions/*.md` |
| How do I do X (add an endpoint, change schema, debug realtime, review a PR)? | `docs/workflows/*.md` |

Each backend service and `frontend/` has its own `AGENTS.md` one level down with routes, data owned, invariants, and known limitations — read the relevant one before editing that module.

## Before making any change

1. Read this file, then the target module's `AGENTS.md`, then [MODULES.md](MODULES.md) to check its deployment/test status — a change to a non-deployable service (e.g. `expense-service`) has different stakes than one to `auth-service`.
2. Trace the actual execution path in source — don't infer behavior from `backend/README.md` or `api-contracts.md` alone; both have confirmed drift from the real implementation (see each affected module's `AGENTS.md` for specifics). Treat the code as ground truth.
3. Check [ARCHITECTURE.md](ARCHITECTURE.md)'s "Known architectural risks" and [ENGINEERING_RULES.md](ENGINEERING_RULES.md)'s flagged-code call-outs before changing anything in: WebSocket fan-out (chat/call-signaling), `expense-service`'s balances query, `user-service` avatar/profile routes, `call-signaling-service`'s `wsUrl` generation. These are documented, not hidden — build on the documented understanding rather than rediscovering it.
4. For any change touching more than one service, identify every consumer of the changed contract (HTTP route shape, Kafka event payload, DB table) across **both** `backend/` and `frontend/` — there is no generated type-sharing or contract test to catch a missed consumer (see [TESTING.md](TESTING.md)).

## During implementation

- Follow the patterns in [ENGINEERING_RULES.md](ENGINEERING_RULES.md): centralized query constants, `AppError` subclasses for anything client-visible, parameterized SQL always, zod validation on new routes, `KafkaClient.publish()`'s fire-and-forget semantics (don't make a request fail because an event publish failed).
- Keep changes scoped to the requested behavior. Don't refactor a thin/stub service into a "proper" implementation as a side effect of an unrelated task — if you're fixing a specific issue (e.g. hardening the expense balances query), fix that, and note in your summary if you noticed adjacent debt rather than silently expanding scope.
- If you complete a previously-stubbed feature (S3 avatar upload, media-service produce/consume, a service's missing Dockerfile), close the **whole** gap in the same change: code + Dockerfile/compose entry/k8s manifest + a test, per [ADR 0002](docs/decisions/0002-partial-service-implementation.md) — don't leave the deployment half for later.
- Add or update tests for what you touch even though no existing suite covers it — see [TESTING.md](TESTING.md) for what a first test for each area should look like.

## Database & migrations

- Single shared Postgres schema (`backend/infrastructure/postgres/init.sql`) for all 9 services — table ownership is convention, not enforced. Check [MODULES.md](MODULES.md) for which service owns which tables before adding a column or query elsewhere.
- `auth-service` has its own hand-rolled migration runner (`src/database/migrate.ts`) independent of `init.sql`, tracking only its own table — don't assume other services have an equivalent; most don't.
- Any schema change must be reflected in `init.sql` (the actual bootstrap for local/compose Postgres) and in every query constant file that touches the changed table (`backend/packages/shared/src/database/queries/`).

## API & backward compatibility

- `backend/docs/api-contracts.md` and `websocket-events.md` are the contract reference for the 4 deployable services, but are already known to be behind the code in places (documented endpoints that don't exist, undocumented ones that do — see each service's `AGENTS.md`). If you change a route's request/response shape, update both the doc and every frontend caller in the same change — there's no type generation linking them.
- The frontend hand-maintains its own mirror of backend types (`frontend/src/lib/api/types.ts`). Grep for consumers manually; don't assume a compiler error will catch a shape mismatch given the frontend's loose `tsconfig`.

## Security & secrets

- Never commit a real secret value. `.env` is gitignored; only commit `.env.example`-style placeholders.
- Every service falls back to a hardcoded dev secret if its JWT/DB env var is unset — this fails *open*, not closed. Don't rely on a service merely starting as proof its secrets are configured correctly; see [SECURITY.md](SECURITY.md).
- `media-service` has no auth plugin registered — don't expose it through any gateway/ingress path without adding authentication first.

## Git & destructive operations

- Standard caution applies: no force-push, no `git reset --hard`/`clean` without explicit confirmation, no skipping hooks. This repo has exactly one commit — treat any history-rewriting operation as high-stakes even though "history" is currently short.
- Never run a database migration or seed script against anything other than your own local/dev Postgres instance.

## Keeping docs updated

Documentation here is maintained engineering infrastructure, not a one-time export. When your change makes a line in `MODULES.md`, `ARCHITECTURE.md`, a module `AGENTS.md`, or `backend/docs/*.md` stale (a service becomes deployable, a documented bug gets fixed, a new route is added), **update that doc in the same change**. Run `node scripts/validate-docs.mjs` before finishing — it checks that every relative link resolves and that every service has an `AGENTS.md`; it does not check factual accuracy, so re-read what you touched. See [docs/standards/markdown-authoring.md](docs/standards/markdown-authoring.md) for how to write the update.

## Definition of done

- [ ] Change is scoped to what was asked; no unrelated refactoring.
- [ ] Existing patterns followed (or deviation explicitly justified) per [ENGINEERING_RULES.md](ENGINEERING_RULES.md).
- [ ] Tests added/updated for the changed behavior (even if it's the first test in that file/service).
- [ ] `npm run build` (backend workspace) / `npm run build` (frontend) and `npm run lint` (frontend; backend's has no config — see [TESTING.md](TESTING.md)) run and pass, or failures are explained.
- [ ] Any touched contract (route shape, Kafka event, DB column) has its consumers updated on both sides.
- [ ] Relevant docs updated in the same change; `node scripts/validate-docs.mjs` passes.
- [ ] If a stub/gap was closed, its deployment wiring (Dockerfile/compose/k8s) and docs were closed too, not deferred.
- [ ] Summary states what was actually verified (manual run, specific command output) — this repo has no CI/test suite to lean on, so say so explicitly rather than implying tests passed.

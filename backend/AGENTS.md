# backend/ — AGENTS.md

npm workspaces root for all backend services and the shared package. Read [root AGENTS.md](../AGENTS.md) first if you haven't.

## Purpose

Hosts 9 independent Fastify microservices and the `@nexus/shared` package they all depend on, plus infra config (Postgres init, nginx gateway, k8s manifests). See [../MODULES.md](../MODULES.md) for the verified per-service inventory and [../ARCHITECTURE.md](../ARCHITECTURE.md) for how they fit together.

## Key files

- `package.json` — workspaces `services/*` + `packages/*`; root scripts (`build`, `test`, `migrate`, `seed`) fan out via `--workspaces --if-present`, so they silently skip any workspace missing that script (expected for the thinner services).
- `docker-compose.yml` — only brings up postgres/redis/kafka/zookeeper + **auth-service, user-service, chat-service, call-signaling-service** + nginx gateway. The other 5 services are not here (see [ADR 0002](../docs/decisions/0002-partial-service-implementation.md)).
- `.env.example` — copy to `.env`; see [../backend/docs/environment.md](docs/environment.md) for the full variable reference.
- `infrastructure/postgres/init.sql` — the one schema for all 9 services' tables.
- `infrastructure/nginx/nginx.conf` — local gateway routing (routes only the 4 compose services — not all 9).
- `infrastructure/kubernetes/` — `namespace.yaml`, `configmap.yaml`+Secret, `ingress.yaml` (routes 7 services), `deployments/` (**only** `auth-service.yaml`, `chat-service.yaml` exist — ingress is ahead of deployments, see [../INFRASTRUCTURE.md](../INFRASTRUCTURE.md)).
- `docs/api-contracts.md`, `docs/websocket-events.md`, `docs/environment.md` — human-facing contract docs; accurate for the 4 deployable services with some confirmed drift noted in each service's own `AGENTS.md`.
- `README.md` — product-level quick start and feature overview; treat its per-service feature descriptions as aspirational for the 5 non-deployable services, verified for the other 4 (cross-check against [../MODULES.md](../MODULES.md)).

## Commands

```bash
npm install                                    # installs all workspaces
npm run build --workspaces --if-present        # tsc per service (closest thing to a type-check gate)
npm run test --workspaces --if-present         # jest where configured — currently finds zero test files anywhere
npm run migrate --workspace=@nexus/auth-service # only auth-service has a real migration runner
docker-compose up -d                           # starts the 4 deployable services + infra + gateway
```

`npm run lint` is defined at this level but **there is no `.eslintrc*` anywhere under `backend/`** — verify it does anything before relying on it.

## Safe extension points

- Adding a 10th service: copy `user-service`'s structure (it's the clearest example of the established `routes/services/database` split with auth already wired) as the template, including its Dockerfile and docker-compose entry — don't follow a thin/stub service's structure as the pattern to copy.
- Adding a shared utility: put it in `packages/shared/src/`, export from `index.ts`, bump nothing (no versioning scheme exists — workspace protocol `"*"` always points at the local source).

## Known limitations

See [../MODULES.md](../MODULES.md) and [ADR 0002](../docs/decisions/0002-partial-service-implementation.md) for the full deployment-coverage gap; [../TESTING.md](../TESTING.md) for the test gap.

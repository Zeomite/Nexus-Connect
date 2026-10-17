# Nexus Connect

A real-time communication platform: chat, WebRTC calling, and group expense-splitting, built as independent microservices behind an API gateway.

- **Backend**: `backend/` — 9 Fastify/TypeScript services + a shared package, Postgres + Redis + Kafka. Quick start and API/WebSocket contracts: [backend/README.md](backend/README.md), [backend/docs/](backend/docs/).
- **Frontend**: `frontend/` — Vite + React + TypeScript SPA. Quick start: [frontend/README.md](frontend/README.md).

These are two independent projects (no shared workspace, no shared code) that together form the product.

## For humans

Start with [backend/README.md](backend/README.md) (architecture diagram, local dev quick start, API contracts) and [frontend/README.md](frontend/README.md). For a verified, no-marketing-gloss picture of what's actually implemented, deployable, and tested today — which differs from the backend README in a few places — see [MODULES.md](MODULES.md).

## For AI coding agents

Start at [AGENTS.md](AGENTS.md). It indexes the full documentation set: architecture, module inventory, infrastructure, engineering rules, testing, security, troubleshooting, ADRs, and reusable workflows. [CLAUDE.md](CLAUDE.md) adds Claude-Code-specific notes on top of it.

## Documentation structure

```
AGENTS.md              start here (agents)
CLAUDE.md              Claude Code specifics, defers to AGENTS.md
ARCHITECTURE.md        system topology, request/event flows, known risks
MODULES.md             verified inventory of every service/package, deployment+test status
INFRASTRUCTURE.md      containers, data stores, networking, env, observability
ENGINEERING_RULES.md   conventions actually used, with known deviations flagged
TESTING.md             what test tooling exists, what has zero coverage
SECURITY.md            auth/authz/secrets, known gaps
TROUBLESHOOTING.md     verified fixes for real failure modes
docs/decisions/        ADRs (harness decisions + recorded architectural gaps)
docs/workflows/        step-by-step procedures for common change types
docs/standards/        how these docs are written and kept accurate
docs/INDEX.md          curated map of routes/tables/topics/tests to source
scripts/validate-docs.mjs   link/structure checker for this doc set
```

Every backend service, the shared package, and the frontend also has its own `AGENTS.md` one level down.

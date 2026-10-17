# ADR 0001: Documentation Methodology for AI Agents

- **Status:** Accepted
- **Date:** 2026-10-15

## Context

Nexus Connect has no existing agent-facing documentation: no `AGENTS.md`, `CLAUDE.md`, or ADRs. It does have good human-facing docs (`backend/README.md`, `backend/docs/api-contracts.md`, `backend/docs/websocket-events.md`, `backend/docs/environment.md`) that are largely accurate for the four fully-wired services but drift from the actual code in several places (documented endpoints that don't exist, undocumented endpoints that do, a documented 2-step password reset vs. an implemented 3-step flow). The repo is a single "Initial commit" — there is no git history to mine for rationale, and no CI.

We need a system that lets an AI coding agent land in this repo cold and quickly find: what's true, what's a known gap, and where to look next — without re-deriving it by reading 26k lines of source every session.

## Decision

1. **`AGENTS.md` is the primary, authoritative instruction format**, at the root and at every meaningful module boundary (each backend service, the shared package, the frontend app). This is the emerging cross-agent convention and keeps the harness usable by any coding agent, not just Claude Code.
2. **`CLAUDE.md` at the root is a thin pointer**, not a parallel copy — it tells Claude Code to treat `AGENTS.md` as the source of truth and adds only Claude-Code-specific notes (skills, hooks) where they exist. This avoids the two files drifting apart, per [[0003-no-duplication-between-agents-md-and-claude-md]] (see standards doc instead — no separate ADR needed, folded into the authoring standard).
3. **No spec-driven framework (BMAD, Spec Kit, OpenSpec) is adopted.** Rationale: the repo has no existing spec workflow, a single contributor, and most of the near-term work is "finish what's half-built" rather than "design new large features from a spec." Introducing a heavyweight framework now would add process overhead disproportionate to the codebase's actual size (~26k lines) and would compete with, rather than extend, the existing `backend/docs/*.md` convention. Revisit this decision if the team grows or a formal RFC process is requested.
4. **Existing docs are extended, not replaced.** `backend/README.md`, `backend/docs/api-contracts.md`, `backend/docs/websocket-events.md`, and `backend/docs/environment.md` remain the human quick-start references. The new root-level docs (`ARCHITECTURE.md`, `MODULES.md`, etc.) are the verified, agent-facing layer and explicitly call out where they diverge from the older docs, rather than silently rewriting them.
5. **ADRs are lightweight and used sparingly** — only for decisions about the harness itself and for recording significant *known* architectural gaps that future agents would otherwise rediscover from scratch (see [[0002-partial-service-implementation]]). They are not retrofitted for every historical decision, since no history exists to recover.
6. **A hand-curated repo index (`docs/INDEX.md`) over a generated one.** The codebase is small enough (9 services + 1 shared package + 1 frontend, ~26k lines) that a curated index stays accurate with normal maintenance discipline, and avoids the complexity of a build step, database, or embedding service. A small Node validation script (`scripts/validate-docs.mjs`) checks link integrity and structural consistency (every service has an `AGENTS.md`, every link resolves) but does not regenerate content — see [[../standards/markdown-authoring]].

## Consequences

- Agents should read root `AGENTS.md` first, then the module `AGENTS.md` for whatever they're touching, before reading source.
- Documentation accuracy depends on contributors updating `AGENTS.md`/`MODULES.md` alongside code changes — there is no generator to fall back on. The validation script catches broken links and missing files, not staleness of facts.
- Known implementation gaps (partial service wiring, missing tests, specific bugs) are recorded explicitly in [[0002-partial-service-implementation]] and in each module's `AGENTS.md`, rather than left for the next agent to rediscover.

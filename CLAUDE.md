# CLAUDE.md

Claude Code: **[AGENTS.md](AGENTS.md) is the source of truth** for this repo — read it first, not this file. This file only adds the few things specific to Claude Code itself, to avoid a second copy of the real instructions drifting out of sync (see [ADR 0001](docs/decisions/0001-documentation-methodology.md)).

## Claude-Code-specific notes

- No custom skills, hooks, subagents, or slash commands are defined for this repo (no `.claude/` directory exists). If you add one, document what it does and why here, and keep this section as the index — don't let it grow into a parallel instruction set.
- The repo's own documentation validation script is `scripts/validate-docs.mjs` (plain Node, no new dependency) — run it with the Bash tool before finishing any change that touches Markdown under the doc hierarchy.
- When using subagents/forks to explore this codebase (it's large: 9 backend services + a frontend, ~26k lines), split by module boundary (one service or group of thin services per agent, frontend separately) — that's how this harness itself was built and it maps cleanly onto [MODULES.md](MODULES.md).

Everything else — architecture, engineering rules, testing, security, workflows, module-level instructions — lives in [AGENTS.md](AGENTS.md) and the docs it links to. Start there.

# Markdown Authoring Standard

Governs every Markdown file added under this harness (root docs, `docs/`, module `AGENTS.md`). Applies to humans and agents writing or editing these files.

## File placement

| Content | Location |
|---|---|
| Agent instructions for a module | `<module>/AGENTS.md` |
| Cross-cutting engineering doc (architecture, rules, testing, security...) | repo root (`ARCHITECTURE.md`, etc.) |
| Architecture Decision Record | `docs/decisions/NNNN-kebab-title.md`, sequential, zero-padded to 4 digits |
| Reusable multi-step procedure | `docs/workflows/kebab-title.md` |
| A rule about *how documentation itself is written* | `docs/standards/` |
| Repo-wide index of modules/routes/tables | `docs/INDEX.md` |

Don't create a new root-level `*.md` file for something that fits inside an existing one. Don't create a module `AGENTS.md` for a directory that has no behavior of its own (e.g. a pure types-only subfolder) — fold it into the parent module's file instead.

## Required sections

- **`AGENTS.md` (any level):** Purpose, Entry points / key files, Public interface or routes, Data owned, Invariants & business rules, Known limitations, Testing, Safe extension points. Omit a section only if it's genuinely not applicable (state that, don't just delete the heading silently if the omission would surprise a reader).
- **ADR:** Status, Date, Context, Decision, Consequences — see `docs/decisions/0001-*.md` for the template.
- **Workflow doc:** a numbered procedure using this repo's actual commands, plus a "when NOT to use this" note if relevant.

## Verified fact vs. assumption vs. known gap

Every claim in these docs falls into one of three categories and must be marked when it isn't obvious from context:

- **Verified**: confirmed by reading the source, a config file, or running a command. State it plainly, no hedge.
- **Known gap / risk**: confirmed absence, bug, or fragile pattern (e.g. "no automated tests exist", "balances query relies on an implicit comma-join that happens to be correct but is easy to misread as buggy"). State it plainly as a fact, not a suggestion — these came from reading the code (and, where the finding was surprising, from independently re-deriving it), not guessing.
- **Unverified / assumption**: anything not directly confirmed (e.g. "TURN credentials are presumably supplied by `call-signaling-service`'s `iceServers` payload — not confirmed by reading that path"). Mark explicitly with "unverified" or "assumption" inline. Never state an assumption as fact.

Do not fill a gap in understanding with a plausible-sounding guess. Write "unknown — not found in source" instead.

## Links and source references

- Use relative Markdown links, resolved from the linking file's own location — for example, this file links to [MODULES.md](../../MODULES.md) with a `../../` prefix because it lives two directories deep; a file at the repo root would use a bare `./` prefix instead. Every link must resolve to a file that exists — `scripts/validate-docs.mjs` checks this.
- Reference source with `path/from/repo/root:line` when citing specific behavior (e.g. `backend/services/auth-service/src/services/auth.service.ts`), so the claim is checkable and survives the file being refactored (line numbers may drift; re-verify, don't assume).
- Cross-link related docs/ADRs with `[[bracketed-name]]` is reserved for memory files (`.claude` memory system) — inside this repo's own Markdown, use normal relative links instead, so the links actually resolve in GitHub/editors.

## Mermaid diagrams

Use a Mermaid fenced block only for relationships/flows that are genuinely clearer as a picture (service topology, a multi-hop request/event flow, a state machine). Every diagram must be labeled as either the verified current architecture or an explicitly-marked target/aspirational state — never draw the aspirational system without saying so (e.g. the README's scaling diagram implies Redis-backed cross-instance WebSocket fan-out; it does not exist yet — any diagram repeating that claim must say "not yet implemented, see ARCHITECTURE.md").

## Code blocks

Always label the language (```ts, ```sql, ```bash, ```yaml, ```http). Keep examples short and real — copy an actual route/table/env var name rather than inventing a placeholder, except for secret values (never paste real secrets; use the same `change-me`-style placeholders already used in `.env.example`).

## Updating vs. creating

- Prefer extending an existing doc's section over adding a new file.
- When behavior changes, update the doc in the same change — don't defer. If you can't, leave a `<!-- STALE: verify against src/... after <change> -->` HTML comment at the relevant section so it's greppable.
- `scripts/validate-docs.mjs` only checks structural integrity (links resolve, required files exist), not factual accuracy — it cannot catch a stale claim. Treat its pass as necessary, not sufficient.

## Avoiding duplication

A fact should have exactly one authoritative home:

- Environment variables → `backend/docs/environment.md` (don't re-list them elsewhere; link instead).
- HTTP/WebSocket contracts → `backend/docs/api-contracts.md` / `backend/docs/websocket-events.md`, corrected in place where this harness found drift, rather than re-documented in `MODULES.md`.
- Per-service implementation detail → that service's `AGENTS.md`, linked from `MODULES.md`, not copied into it.

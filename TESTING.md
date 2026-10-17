# Testing

## The one fact that matters most

**There are no automated tests anywhere in this repository that test real behavior.** Verified by searching the whole tree:

```bash
find backend -name "*.test.ts" -o -name "*.spec.ts"   # zero results
find frontend/src -name "*.test.*"                     # one result: src/test/example.test.ts
```

`src/test/example.test.ts` contains a single placeholder assertion (`expect(true).toBe(true)`) and tests nothing about the application. 5 of 9 backend services declare `"test": "jest"` in `package.json` and have `jest`/`@types/jest` as devDependencies, but have no `jest.config.js` and no test files — running `npm test` in any of them currently does nothing useful (no tests found).

Do not report "tests pass" as meaningful verification of backend or frontend behavior changes until real tests exist. Verification today means manual exercise of the change (see [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for how to run services locally) plus careful code reading, not a green CI check — there is no CI either (`.github/` doesn't exist).

## What commands exist today

| Command | Where | What actually happens |
|---|---|---|
| `npm test` | `backend/` (root) | `npm run test --workspaces --if-present` — runs jest in the 5 services that declare it; all report "no tests found" |
| `npm test` | any `backend/services/<name>/` with jest configured | Same — no tests found |
| `npm run test` | `frontend/` | `vitest run` — executes the one placeholder test, passes trivially |
| `npm run test:watch` | `frontend/` | `vitest` in watch mode |
| `npm run lint` | `backend/` (root) | `eslint . --ext .ts,.js` — **no `.eslintrc*` file exists anywhere under `backend/`**, so this command has no config to run against; verify it actually does anything before relying on it |
| `npm run lint` | `frontend/` | `eslint .` against `frontend/eslint.config.js` (flat config) — this one is real and configured |
| `npm run build` | `backend/` (root) | `tsc` per workspace — this is the closest thing to a type-check gate the backend has |
| `npm run build` / `build:dev` | `frontend/` | `vite build` — uses esbuild/swc, does **not** perform a full TypeScript type-check; there is no `tsc -b`/`typecheck` script in `frontend/package.json`, so a build can succeed with type errors present |

## What a new test should look like, since there's no existing pattern to copy

There is no established test convention in this repo to extend — propose, don't assume:

- **Backend unit tests**: target `*.service.ts` business logic with jest, mocking `PostgresClient`/`RedisClient`/`KafkaClient` at the constructor-injection points already used (every service class takes these as constructor args, which makes them mockable without a test framework change). Good first targets: `expense-service`'s balance/split calculation (would lock in the current correct behavior of its fragile comma-join query, see [ENGINEERING_RULES.md](ENGINEERING_RULES.md)), auth-service's unique-number retry logic and register-race behavior.
- **Backend integration tests**: would need a real or containerized Postgres/Redis/Kafka (docker-compose already provides all three) — no test harness currently spins these up for a test run; this would be new infrastructure, not a missing config tweak.
- **Frontend tests**: vitest + `@testing-library/react` are already devDependencies and configured (`vitest.config.ts`, `src/test/setup.ts` mocks `matchMedia`) — the tooling is ready, nothing is written. Highest-value first targets: `AuthContext` (login/logout/token-refresh), `lib/api/client.ts`'s single-flight 401-refresh logic (easy to regress silently), the three WebSocket classes' reconnect/backoff behavior.
- **Contract tests between frontend and backend**: none exist. The frontend's `src/lib/api/types.ts` is a hand-maintained mirror of backend response shapes with no generation or validation step linking them — if you change a backend response shape, grep the frontend for consumers manually; nothing will tell you if you missed one.

## Regression testing expectations until real tests exist

- Any change to a route, WebSocket handler, or Kafka consumer must be manually exercised against a running instance (see [TROUBLESHOOTING.md](TROUBLESHOOTING.md#running-services-locally)) before being considered done — don't rely on `tsc`/`eslint` passing as a substitute for behavior verification.
- When you add the *first* real test for a module, also add the missing `jest.config.js`/test script wiring for that service rather than assuming it already works — verify by actually running `npm test --workspace=@nexus/<service>` and confirming your new test executes.
- If you refactor a fragile-but-correct pattern (e.g. expense-service's comma-join balances query, see [ENGINEERING_RULES.md](ENGINEERING_RULES.md)), add a test locking in the current output *before* refactoring, so a well-intentioned cleanup can't silently change behavior.

## Critical workflows with no test coverage at all (ranked by risk)

1. Auth: registration, login, token refresh/rotation, password reset — zero coverage on a security-critical flow.
2. Expense balances/settlement math — zero coverage; current output is correct but computed via a fragile query pattern worth locking in with a test before anyone refactors it (see [ENGINEERING_RULES.md](ENGINEERING_RULES.md)).
3. WebSocket real-time fan-out (chat, call signaling) — zero coverage on the most architecturally fragile part of the system (see [ARCHITECTURE.md](ARCHITECTURE.md) risk #1).
4. Frontend token-refresh-on-401 single-flight logic — zero coverage on code that's easy to silently break (e.g. reintroducing a refresh storm).

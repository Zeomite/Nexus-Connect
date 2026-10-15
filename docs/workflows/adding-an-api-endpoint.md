# Workflow: Adding an API Endpoint

For a new HTTP route on an existing backend service. If the service is one of the 5 non-deployable ones, read its `AGENTS.md` gaps section first — you may be touching code with known bugs nearby.

1. **Find the pattern to copy.** `user-service` or `chat-service` are the clearest examples of the established `routes/*.routes.ts` → `services/*.service.ts` → `database/queries/*.queries.ts` split. Don't copy a thin service's single-file style for a new, non-trivial endpoint.
2. **Add a zod schema** for the request body/params in the service's validators (or shared `utils/validators.ts` if it's reusable across services), and call `validate()`/`safeValidate()` — see [ENGINEERING_RULES.md](../../ENGINEERING_RULES.md). Don't add an inline cast "just for now" — several existing inline casts in auth-service are exactly that, left unfinished.
3. **Add/extend a query constant** in `backend/packages/shared/src/database/queries/<domain>.queries.ts` rather than inlining SQL in the route or service file.
4. **Throw a specific `AppError` subclass** for every client-distinguishable failure (`NotFoundError`, `ForbiddenError`, etc.) — add a new subclass in `backend/packages/shared/src/utils/errors.ts` if none fits, with a stable `code` string.
5. **Decide rate limiting explicitly.** Check whether the service registers `rateLimitPlugin`/a per-route limiter at all (several don't — see [ENGINEERING_RULES.md](../../ENGINEERING_RULES.md#rate-limiting--inconsistent-today-pick-deliberately)). Don't assume it's handled just because `@nexus/shared` exports the helper.
6. **Update the contract docs in the same change**: `backend/docs/api-contracts.md` (and `websocket-events.md` if it's a WS message, not HTTP) — several existing endpoints are undocumented; don't add to that pile.
7. **Update `nginx.conf`'s `location` block** if the route needs to be reachable through the local gateway, and `ingress.yaml` for k8s — check [MODULES.md](../../MODULES.md) first; several services aren't routed at all today.
8. **Update the frontend caller** if this endpoint is meant to be used by the app: add to `frontend/src/lib/api/config.ts`'s endpoint map, a typed wrapper in the relevant `lib/api/*.ts` file, and a React Query hook in `hooks.ts` if it'll be consumed by a component. There is no type generation linking frontend and backend — do this by hand and grep for existing similar endpoints as a template.
9. **Write a test.** There's no existing test to extend in most services — this may be the first one in that file. See [TESTING.md](../../TESTING.md) for what to prioritize.
10. Run `node scripts/validate-docs.mjs` if you touched any Markdown.

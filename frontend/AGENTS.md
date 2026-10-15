# frontend/ — AGENTS.md

Independent npm project (Vite + React 18 + TypeScript + shadcn/ui + TanStack Query + React Router). No shared workspace or code with `backend/` — its API/WS types in `src/lib/api/types.ts` are a hand-maintained mirror, not generated.

## Entry points & routing

`src/main.tsx` → `src/App.tsx`: `QueryClientProvider` (retry:1, no refetch-on-focus) → `TooltipProvider`+`Toaster`/`Sonner` → `BrowserRouter` → `AuthProvider` → `NotificationProvider` → `Routes`. Protected routes (`/chats`, `/dial`, `/contacts`, `/history`, `/profile`, `/settings`) wrap `MainLayout`; `/call`, `/call/:callId` are protected but full-screen outside the layout; `/login`/`/register` use `PublicOnlyRoute` (redirect away if already authed).

## Key directories

| Path | Contents |
|---|---|
| `src/contexts/AuthContext.tsx` | Token/user state, login/register/logout, mount-time `getCurrentUser()` check |
| `src/lib/api/client.ts` | Hand-rolled fetch wrapper, single-flight 401-refresh-and-retry, `ApiRequestError` parsed from the backend's `{error:{code,message,details}}` shape |
| `src/lib/api/config.ts` | Base URL + endpoint map — **has a real bug, see below** |
| `src/lib/api/hooks.ts` | React Query hooks/mutations per domain, `queryKeys` factory |
| `src/lib/websocket/{Chat,Notification,Signaling}WebSocket.ts` | Three independent classes, no shared base — each hand-rolls its own reconnect/backoff/heartbeat |
| `src/pages/` | One file per route, see table below for real-vs-mock status |
| `src/components/` (non-`ui/`) | App-specific components (`ChatMessage`, `IncomingCallModal`, `Sidebar`, etc.); `components/ui/*` is shadcn-generated, not hand-written app logic |
| `src/test/` | `setup.ts` (mocks `matchMedia`), `example.test.ts` (placeholder only) |

## Known bug — read before touching API base URL config

`src/lib/api/config.ts` has `const isDevelopment = "true"` — a **string literal, always truthy**. It never reads `import.meta.env.VITE_API_URL` or `import.meta.env.DEV`. The Dockerfile's `--build-arg VITE_API_URL` → `ENV VITE_API_URL` plumbing is therefore dead: production builds still target `http://localhost:8080`. Fix by reading the actual Vite env var; don't add a second config path around this bug.

## Auth

Tokens (`nexus_access_token`, `nexus_refresh_token`) and user object (`nexus_user`) live in **`localStorage`**, not httpOnly cookies — see [../SECURITY.md](../SECURITY.md) for the XSS-exposure trade-off this implies. `logout()` only clears local state, no server-side revocation call. `register()` does not auto-login (matches the backend's email-verification-required flow). The frontend already calls auth-service's real 3-step password-reset flow (`verifyResetCode`→`updatePassword`) — if `../backend/docs/api-contracts.md` still shows a 2-step flow when you read this, the doc is stale, not the frontend.

## WebSocket / real-time

`useChatWebSocket` (used in `MainLayout`, global) wires chat events into React Query cache invalidation + local typing state. **`NotificationContext` and `useIncomingCall` independently re-implement nearly identical subscribe/reconnect/polling-fallback logic against the same `NotificationWebSocket` singleton** — only `useIncomingCall`'s state is actually consumed by any component (`MainLayout`); `NotificationContext`'s own `incomingCall` state appears to have no consumer. If you're touching incoming-call handling, consolidate onto one of these rather than adding a third copy.

## Calling

Real WebRTC: `getUserMedia` → `RTCPeerConnection` (STUN fallback `stun:stun.l.google.com:19302` if the backend sends none) → offer/answer/ICE relayed through `SignalingWebSocket` → peer-to-peer media. **This is pure mesh P2P — the frontend never calls `media-service`** (see [../backend/services/media-service/AGENTS.md](../backend/services/media-service/AGENTS.md)); works for 1:1, unverified at scale for group calls since the mesh-loop-per-participant logic exists but wasn't clearly exercised beyond 1:1 in what was read. `IncomingCallModal`'s caller-name resolution is an **explicit placeholder** returning "Unknown Caller" (comment in code: "We'll need to add an endpoint to get user by ID").

## Pages — real vs. mock, verified by reading each file

| Page | Status |
|---|---|
| Chats | Real — paginated/infinite messages, typing indicators, mark-as-read, inline call launch |
| Contacts | Real — search, add-contact, create-group; **no expense/balance UI** despite backend types already existing in `types.ts` |
| CallHistory | Real list and date grouping; **search box is cosmetic** — `filteredCalls` ignores `searchQuery` entirely |
| Profile | Mostly real; `statusMessage` field is **local-only state, never persisted** (no backing API field) |
| Settings | **Entirely static mock** — hardcoded sections, uncontrolled `Switch defaultChecked`, no state, no handlers wired |

## Testing

Vitest + Testing Library are configured and ready (`vitest.config.ts`, `src/test/setup.ts`) but **zero real tests exist** — the only test file is a trivial placeholder. No `typecheck` script exists (`vite build` uses esbuild/swc, not full `tsc`) — a build can succeed with type errors present. `tsconfig.app.json` deliberately disables `strict`/`noImplicitAny`/unused-var checks (shadcn scaffold default) — don't tighten this as a side effect of unrelated work, but don't add new `any` gratuitously either.

## Known gaps / dead code

- `useOptimisticMessage` (`lib/api/hooks.ts`) is defined, never imported anywhere.
- No expense/settlement/balance pages despite full backend contract + frontend types existing (`CreateExpenseRequest`, `GroupBalancesResponse` in `types.ts`) — building this is unblocked, just not done.
- Frontend dev server defaults to port 8080 (`vite.config.ts`), same as the backend's nginx gateway — see [../TROUBLESHOOTING.md](../TROUBLESHOOTING.md) for the collision this causes running both natively.

## Commands

```bash
npm install
npm run dev          # vite dev server, :8080
npm run build         # vite build (no full type-check)
npm run build:dev     # --mode development variant
npm run lint          # eslint . — real, configured (flat config)
npm run test          # vitest run
npm run test:watch    # vitest watch
```

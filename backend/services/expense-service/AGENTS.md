# expense-service — AGENTS.md

Port 3007. **Not deployable**: no Dockerfile, not in `docker-compose.yml`, no k8s Deployment (though `ingress.yaml` already routes to it). 0 tests. **Most functionally complete of the 5 non-deployable services.**

## Purpose

Expense creation with equal/exact/percentage splits, settlement recording, immutable ledger, group balance calculation.

## What's real

`POST /expenses` does genuine transactional work: verifies group membership, inserts `expenses` + `expense_splits` + `ledger_entries` in one transaction, and **all three split types are computed correctly** (equal = total/n, exact = given amount, percentage = total×pct/100), with ledger entries created only for non-payer splits. `GET /groups/:id/expenses` and `POST /settlements` are real. Publishes `EXPENSE_CREATED`.

## Fragile-but-correct balances query — read before touching it

`GET /groups/:groupId/balances` queries `FROM ledger_entries, group_members WHERE ledger_entries.group_id = $1 AND group_members.group_id = $1` — an implicit comma-join with no predicate linking the two tables. At a glance this looks like a cross-join bug that would inflate every balance by the group's member count; **it was independently verified (by simulating the query's exact row-by-row semantics) to produce correct output**, because `GROUP BY user_id` resolves `user_id` unambiguously to `group_members.user_id` (the only table in scope with that column), and `group_members`' `(group_id, user_id)` primary key guarantees exactly one matching row per member — so each member's aggregate is computed over exactly the group's ledger entries, not multiplied by member count. It's still worth rewriting as an explicit, unambiguous query (see [../../../ENGINEERING_RULES.md](../../../ENGINEERING_RULES.md#database-access--established-with-one-bug-to-know)) since the current form is easy to misread as broken and fragile to future schema changes — but **do not "fix" it by just adding a join predicate without a test proving the output is unchanged**; the risk here is a well-intentioned refactor introducing the bug that was previously only cosmetic.

## Before extending

This service has no Dockerfile/compose entry/k8s manifest despite being the most feature-complete of the five thin services — if you're hardening the balances query or adding a feature here, consider closing the deployment gap in the same change (copy `user-service`'s Dockerfile/compose pattern), per [ADR 0002](../../../docs/decisions/0002-partial-service-implementation.md). The frontend has no expense/balance UI at all today despite the backend contract and frontend types (`CreateExpenseRequest`, `GroupBalancesResponse` in `frontend/src/lib/api/types.ts`) already existing — building that UI is unblocked by the backend, it's simply not built yet.

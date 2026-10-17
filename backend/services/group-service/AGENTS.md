# group-service — AGENTS.md

Port 3006. **Not deployable**: no Dockerfile, not in `docker-compose.yml`, no k8s Deployment (though `infrastructure/kubernetes/ingress.yaml` already routes to it — ingress is ahead of the deployment manifests). 0 tests.

## Purpose

Group creation/listing/update, membership management, role-based permissions (owner/admin/member).

## What's real

Create/list/get/update group and add/remove member are genuinely implemented against `groups`/`group_members`. **Role permissions are actually enforced** — `getGroupPermissions(role)` gates `canEditGroup`/`canAddMembers`/`canRemoveMembers`, confirmed by code read (this is the most complete piece of access control among the 5 thinner services). Publishes `GROUP_CREATED` to Kafka.

## Known gaps

- No endpoint to change a member's role after they've joined (promote/demote) — only add/remove exist.
- Update-group and remove-member routes exist in code but are **not documented** in `../../docs/api-contracts.md` (code is ahead of docs here, the reverse of most other drift found in this repo).
- Redis client is connected and decorated but never used after connecting — dead dependency (same pattern as media-service).
- No Dockerfile/compose entry/test script.

## Before extending

If you add a role-change endpoint, reuse `getGroupPermissions` rather than inventing a parallel permission check — it's the one piece of this service worth treating as a reference pattern. Close the deployment gap (Dockerfile, compose, k8s Deployment matching what `ingress.yaml` already expects) in the same change if you're making this service production-relevant, per [ADR 0002](../../../docs/decisions/0002-partial-service-implementation.md).

# 2026-03-28 Hosted Device-Sync Store Split

## Goal

Split `apps/web/src/lib/device-sync/prisma-store.ts` internally by concern so the hosted Prisma control-plane store is easier to reason about, while preserving:

- the separate hosted Postgres vs local SQLite trust boundary
- the current public `PrismaDeviceSyncControlPlaneStore` API surface
- replay protection semantics for browser assertion nonces
- webhook trace claim/reclaim lifecycle behavior
- agent-session auth and rotation behavior
- connection refresh locking through the existing advisory-lock entrypoint unless extraction proves safe

## Scope

Primary files:

- `apps/web/src/lib/device-sync/prisma-store.ts`
- targeted `apps/web/test/prisma-store-{browser-auth-nonce,agent-session,device-sync-signal,local-heartbeat}.test.ts`

Secondary callers/tests only if needed to keep type safety or truthful references aligned.

## Constraints

- Do not collapse or unify the hosted Prisma store with `packages/device-syncd/src/store.ts`.
- Keep `PrismaDeviceSyncControlPlaneStore` as the façade consumed by the current control-plane/auth/agent services.
- Extract one concern at a time behind private collaborators.
- Preserve transaction scope and locking behavior, especially around webhook claims, session rotation/revocation, and `withConnectionRefreshLock`.
- Prefer behavior-preserving internal structure changes over public API cleanup in this pass.

## Planned Shape

Private concern collaborators inside `prisma-store.ts` unless a small adjacent split becomes clearly justified:

1. OAuth/session ingress collaborator
2. Webhook trace lifecycle collaborator
3. Connection secret bundle + connection metadata collaborator
4. Sparse signal collaborator
5. Browser assertion nonce collaborator
6. Agent session collaborator
7. Local heartbeat/status patch collaborator

`PrismaDeviceSyncControlPlaneStore` remains the façade that delegates to these collaborators and continues to own broad transaction/lock helpers where appropriate.

## Verification

Target focused proof:

- `apps/web/test/prisma-store-browser-auth-nonce.test.ts`
- `apps/web/test/prisma-store-agent-session.test.ts`
- `apps/web/test/prisma-store-device-sync-signal.test.ts`
- `apps/web/test/prisma-store-local-heartbeat.test.ts`

Then repo-required checks per `AGENTS.md` / verification docs as feasible.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28

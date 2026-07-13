# PR 563 ReviewGPT Follow-up

## Goal

Close the two accepted exact-head ReviewGPT findings returned after PR 563
merged:

1. Make the group-join-confirmation producer enable/redeploy/drain transition a
   fail-closed repository-owned production path.
2. Let one untargeted activation or private-inbound recovery trigger consume a
   small ordered batch of a member's eligible confirmation obligations under
   the existing total deadline.

## Constraints

- Preserve exact server-rendered private copy, stable membership idempotency,
  origin selection, sanitization, and fail-closed route authority.
- Keep targeted current-join reconciliation single-item.
- Add no scheduler, queue, second lifecycle owner, or downloaded secret.
- Bind rollout to the exact proven production deployment and stop on alias
  drift, environment update failure, redeploy failure, or incomplete drain.
- Keep the patch isolated to the PR 563 feature lane.

## Working Set

- `.github/workflows/hosted-web-contract-migrations.yml`
- `ARCHITECTURE.md`, `agent-docs/SECURITY.md`, and rollout verification docs
- `apps/web/app/api/internal/hosted-groups/join-confirmations/rollout/route.ts`
- `apps/web/scripts/complete-group-join-confirmation-rollout.ts`
- `apps/web/src/lib/hosted-groups/group-join-confirmation.ts`
- focused hosted group-confirmation and production workflow tests
- group-confirmation deployment docs

## Verification Plan

- Focused Vitest for ordered bounded multi-obligation recovery, replay,
  deferral, deadline remainder, rollout auth, provider response parsing, alias
  drift, environment upsert, redeploy, and drain pagination.
- Hosted-web prepared typecheck and scoped/full verification required by the
  completion workflow.
- Guarded commit/push, CI, and ReviewGPT on the exact follow-up head until zero
  accepted findings.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13

# PR 611 ReviewGPT Round 1

## Goal

Close the two accepted exact-head ReviewGPT findings on PR 611 without
weakening the group-join confirmation UX:

1. Prevent an older rollout workflow from restoring its deployment after a
   newer production deployment wins.
2. Give the temporary rollout control plane an explicit owner and removal
   condition instead of treating it as steady-state deployment machinery.

## Constraints

- Preserve private server-rendered exact copy, sanitized group names,
  origin-specific web/reaction variants, membership idempotency, and no reply
  requirement.
- Build any required producer-enabled deployment without assigning production
  domains until the final fail-closed ownership checks pass.
- Never promote or drain through an old rollout after the production alias has
  moved.
- Add no scheduler, queue, durable rollout state, or downloaded secret.
- Keep the initial repository-owned producer transition automatic, then delete
  its temporary route, bearer, provider orchestration, and workflow step after
  the documented terminal drain condition.

## Working Set

- `.github/workflows/hosted-web-contract-migrations.yml`
- `ARCHITECTURE.md`, `agent-docs/SECURITY.md`, and group-confirmation rollout docs
- `apps/web/scripts/complete-group-join-confirmation-rollout.ts`
- focused rollout and production-workflow tests

## Verification Plan

- Focused Vitest proving staged production redeploy, single guarded promotion,
  alias drift during the build, no stale promotion/drain, and lifecycle guards.
- Hosted-web typecheck, documentation drift, diff check, and parent final
  security/coverage review per the user's no-subagent instruction.
- Guarded push, green PR CI, and a fresh ReviewGPT round on every PR-specific
  head until zero accepted findings.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13

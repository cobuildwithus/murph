# Goal (incl. success criteria):
- Land only the missing behavior from the supplied device-sync webhook follow-up patch.
- Success means pass3 behavior remains intact, accepted/unknown ingress hooks receive one explicit durable `traceId` plus a stripped ingress webhook object, and hosted wake persistence completes the webhook trace only after the signal and outbox enqueue commit in the same transaction.

# Constraints/Assumptions:
- Treat the supplied patches as behavioral intent, not overwrite authority.
- Preserve unrelated dirty worktree edits.
- Keep the change scoped to `packages/device-syncd` and hosted-web device-sync files/tests.
- Assume pass3 is already landed unless current source proves otherwise.

# Key decisions:
- Reuse the existing pass3 durable trace derivation instead of reapplying it.
- Introduce a dedicated ingress webhook type rather than passing raw provider webhook payload objects through accepted/unknown hook boundaries.
- Replace the hosted wake publish helper with a transactional persist helper so signal creation, outbox enqueue, and optional webhook-trace completion share one transaction.

# State:
- in_progress

# Done:
- Read repo workflow, security, reliability, verification, completion, and testing docs.
- Confirmed the pass3 patch is already effectively landed.
- Identified the missing target-area follow-up changes in `device-syncd` and hosted-web wake handling.

# Now:
- Implement the missing contract split and transactional hosted wake flow.

# Next:
- Run scoped verification and direct scenario proof.
- Run required audit passes and commit the scoped diff.

# Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether any additional hosted-web test setup adjustment is needed beyond the current test harness once the transactional helper lands.

# Working set (files/ids/commands):
- Patch inputs: `murph-security-audit-pass3.patch`, `murph-target-area-webhook-followup.patch`
- Commands: `patch -p1 --dry-run`, `git status --short`, focused `sed`, `rg`
- Files: `packages/device-syncd/src/{types.ts,public-ingress.ts,service.ts}`, `apps/web/src/lib/device-sync/{public-ingress-service.ts,wake-service.ts,prisma-store.ts}`, targeted tests
Status: completed
Updated: 2026-04-11
Completed: 2026-04-11

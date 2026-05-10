# Pending Nudge Clear Guard

Status: completed
Created: 2026-05-10
Updated: 2026-05-10

## Goal

Prevent the generation-guarded stale pending-nudge clear path from clearing a legitimate same-generation `work` alarm after the pending nudge it observed was already consumed.

## Success criteria

- `clearPendingInvocationNudge()` clears `pending_nudge`, `pending_work`, and the `work` alarm only when the expected generation still matches and `pending_nudge` is still set.
- A focused state-store regression proves a same-generation consumed nudge leaves a future `work` alarm intact.
- Focused Cloudflare tests and typecheck pass, or any unrelated blocker is recorded precisely.

## Scope

- `apps/cloudflare/src/user-runner/runner-state-store.ts`
- `apps/cloudflare/test/runner-state-store.bundle-slots.test.ts`

## Constraints

- Preserve the existing Durable Object state ownership model.
- Do not widen the queue boundary into a generic `pending_work` clearer.
- Preserve unrelated active runner and ledger edits in the shared checkout.

## Verification

- Passed:
  - `git diff --check -- apps/cloudflare/src/user-runner/runner-state-store.ts apps/cloudflare/test/runner-state-store.bundle-slots.test.ts agent-docs/exec-plans/active/2026-05-10-pending-nudge-clear-guard.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/runner-state-store.bundle-slots.test.ts`
  - `pnpm --dir apps/cloudflare typecheck`
  - `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner/runner-state-store.ts apps/cloudflare/test/runner-state-store.bundle-slots.test.ts`
- Blocked/unrelated:
  - `pnpm typecheck` fails in `packages/cli/test/inbox-cli.test.ts` because local test doubles are missing `getAttachment`. This task did not touch CLI.
- Audits:
  - `security-privacy-review`: no findings.
  - `coverage-write`: no changes needed; existing regression covers the exact store boundary.
  - `task-finish-review`: low metadata finding fixed by this plan update; no code findings.

## State

- Now: implementation, focused proof, Cloudflare verification, and required audits are complete.
- Next: close the plan with `scripts/finish-task` and create the scoped commit.
Completed: 2026-05-10

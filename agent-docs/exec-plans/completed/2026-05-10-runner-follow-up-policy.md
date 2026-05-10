# Runner Follow-Up Policy

Status: completed
Created: 2026-05-10
Updated: 2026-05-10

## Goal

Make the hosted runner follow-up policy explicit after invocation/checkpoint cleanup so `pendingNudge` no longer has scattered call-site meaning.

## Success criteria

- One helper owns the decision order:
  - pending nudge with effective lag present or unknown continues the nudge path
  - pending nudge with drained effective lag clears the stale pending flag
  - in-flight work schedules recovery
  - no pending work leaves ordinary next wake or idle-checkpoint scheduling to the caller
- Existing retry timing and stale pending-nudge clear behavior are preserved.
- Focused Cloudflare tests and scoped verification pass, or unrelated blockers are recorded.

## Scope

- `apps/cloudflare/src/user-runner.ts`
- focused Cloudflare runner tests as needed

## Constraints

- Do not introduce new retry architecture or latency paths.
- Do not widen Cloudflare's authority beyond Durable Object runner coordination.
- Preserve unrelated active runner and ledger edits in the shared checkout.

## Verification

- Passed:
  - `git diff --check -- apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/exec-plans/active/2026-05-10-runner-follow-up-policy.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/user-runner-alarm.test.ts`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --project cloudflare-node-platform --no-coverage test/user-runner-alarm.test.ts`
  - `pnpm --dir apps/cloudflare typecheck`
  - `MURPH_VITEST_FILE_PARALLELISM=0 bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts`
- Blocked/unrelated:
  - Normal `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts` failed inside full `apps/cloudflare verify` on fake-timer boundary assertions in `user-runner-alarm.test.ts`; the exact file/project passes, and the file-parallelism-disabled scoped verifier passes.
  - `pnpm typecheck` fails in `packages/cli/test/inbox-cli.test.ts` because local test doubles are missing `getAttachment`. This task did not touch CLI.
- Audits:
  - `security-privacy-review`: no findings.
  - `coverage-write`: added unknown-lag pending nudge follow-up proof.
  - `task-finish-review`: low metadata finding fixed by this plan update; no code/test findings.

## State

- Now: implementation, focused proof, scoped verification, and required audits are complete.
- Next: close the plan with `scripts/finish-task` and create the scoped commit.
Completed: 2026-05-10

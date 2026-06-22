# Hosted Lost Active-Operation Fix

## Goal

Fix the hosted runtime path where a live foreground invocation can be lost after the outer runner's in-memory active-operation pointer disappears, causing fresh conversation input to sit behind idle checkpoint or replacement startup instead of waking the existing write-fenced runtime.

Success means:

- exact active runtime wakes are attempted by durable identity, not only by the outer process-local pointer
- stale or mismatched identities do not clear the active write fence
- idle checkpoint publication refuses to commit over durable unimported foreground conversation input
- focused hosted-local/E2E or unit coverage proves the lost-active-operation regression and checkpoint foreground guard
- the fix lands on a branch PR only, with no push to `main` and no prod/deploy actions

## Constraints

- Keep Cloudflare as the execution adapter; do not add a scheduler, queue, or force-recycle recovery path.
- Web remains the durable owner of mailbox ordering and workspace checkpoint metadata.
- Runtime foreground conversation input has priority over idle checkpointing.
- Preserve deployed compatibility where consumers may see old request/response shapes.
- Do not expose secrets, payload contents, direct identifiers, or local paths in artifacts.

## Implementation Notes

- ReviewGPT recommended the smallest durable fix:
  - send exact `{ userId, attemptId, leaseGeneration }` wake identity to the container's `/internal/runtime-wake` endpoint even when `RunnerContainer` lacks its process-local active-child record
  - validate that identity inside the child against the actual active invocation and preserve the durable fence on mismatch, timeout, or unknown status
  - add a durable idle-checkpoint foreground guard using the conversation mailbox high-water versus the runtime's imported conversation sequence
- Avoid broad cleanup of legacy wake/start compatibility in this PR unless needed for the fix.

## Verification Plan

- Add/keep a focused hosted-local regression scenario for lost active operation.
- Add focused web/runtime contract tests for checkpoint foreground-pending behavior.
- Run the narrowest truthful diff/app/package verification first, then required audit passes for this high-risk hosted-runtime change.
- Before handoff, run final local diff review and open a PR from the branch.

## Final State

- Wake now targets the live child by durable `{ userId, attemptId, leaseGeneration }` identity even if the outer runner active-operation pointer is gone.
- Child wake rejects stale attempt, stale lease, and wrong user identity without clearing the active fence.
- Accepted transport failures preserve retry/fence behavior when committed-progress recovery is unknown.
- Idle shutdown checkpoint now refuses to publish when retained conversation mailbox input is ahead of the runtime-imported sequence.
- New web also falls back to `redactedStatus.hostedMailboxConversationImportedSeq` for old checkpoint callers, so web-first deploys protect older runtimes from stale idle checkpoint commits.
- Hosted-local Linq E2E reproduces the lost outer pointer and proves the second inbound message reaches the delayed active-turn provider continuation.

## Verification Completed

- `pnpm --dir packages/hosted-execution test -- hosted-runtime-control.test.ts`
- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-workspace-runner.test.ts hosted-runtime-workspace-entrypoint.test.ts`
- `pnpm --dir apps/web test:prepared -- apps/web/test/hosted-workspace-store.test.ts apps/web/test/hosted-runtime-internal-routes.test.ts`
- `pnpm --dir apps/cloudflare test -- runner-container.test.ts container-entrypoint.test.ts user-runner-alarm.test.ts index.test.ts hosted-local-e2e-support.test.ts hosted-local-dev-harness.test.ts`
- `pnpm --dir apps/cloudflare test -- container-entrypoint.test.ts helpers/hosted-local-dev-harness.test.ts`
- `MURPH_HOSTED_LOCAL_E2E_REUSE_DATABASE_URL=1 DATABASE_URL=<local test db> pnpm hosted-local e2e linq-lost-active-operation --no-bundle`
- `pnpm build:test-runtime:prepared`
- `pnpm test:diff`
- `git diff --check`
- Secret/local-identifier added-line scan; only fake local test env names/values matched.

## Audit Outcome

- Security/privacy review: no medium-or-higher findings.
- Coverage/proof pass: strengthened child wake identity mismatch coverage in `apps/cloudflare/test/container-entrypoint.test.ts`.
- Deep review: accepted and fixed web deploy-skew fallback plus tightened the E2E continuation assertion; re-review found no new production-breaking issue.
Status: completed
Updated: 2026-06-21
Completed: 2026-06-21

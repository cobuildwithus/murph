# Device-Sync Nudge Workflow Fallback

## Goal

Ensure hosted device-sync wakes get the same durable runner-nudge fallback as hosted conversation webhooks: after appending the encrypted mailbox row transactionally, use the appended mailbox item id as the only durable workflow pointer if the direct runner nudge is not accepted.

## Constraints

- Keep workflow input pointer-only: mailbox item id plus source label only.
- Do not include provider webhook bodies, verification headers, secrets, message content, or device-sync hint payloads in workflow input.
- Preserve existing transactional append ordering for device-sync state mutation plus hosted mailbox wake.
- Keep the change narrow to hosted web device-sync wake and directly shared nudge workflow code/tests.

## State

- Done: Confirmed `persistHostedDeviceSyncWake()` appended `device-sync.wake` inside the transaction, then discarded the append result and fire-and-forgot `nudgeHostedRunnerBestEffort()`.
- Done: Updated device-sync wake persistence to capture the appended mailbox item id, await the direct nudge result with the existing hosted webhook timeout, and start the pointer-only durable nudge workflow when the direct nudge is not accepted.
- Done: Moved hosted device-sync webhook trace completion after successful direct nudge or successful workflow enqueue, so workflow-start failures leave the trace retryable.
- Done: Extended the nudge workflow source label to include `device-sync` and kept the workflow context device-sync-specific.
- Done: Added focused and ingress-level regression tests for pointer-only workflow fallback, retryable workflow-start failure, and trace completion ordering.
- Now: Completed.
- Next: Commit is blocked by overlapping dirty hunks in shared workflow/ledger files; hand off the scoped diff and verification.

## Verification

- `git diff --check -- <touched files>` passed.
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --no-coverage test/device-sync-hosted-wake.test.ts test/hosted-onboarding-webhook-workflows.test.ts` passed: 2 files, 31 tests.
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/device-sync/wake-service.ts apps/web/src/lib/hosted-onboarding/webhook-workflow-types.ts apps/web/src/lib/hosted-onboarding/webhook-workflow-steps.ts apps/web/test/device-sync-hosted-wake.test.ts apps/web/test/hosted-onboarding-webhook-workflows.test.ts` passed, including hosted web verify.
- `pnpm typecheck` passed.
- Required security/privacy review: no findings.
- Required coverage-write pass: no changes; focused lane passed.
- Final completion review rerun after trace-ordering repair: no findings.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01

# PR 623 ReviewGPT Snapshot Fence Fix

## Goal

Resolve the accepted ReviewGPT finding for PR 623: workspace snapshot start,
abort, and completion must use the active `UserRunner` write fence before
reading or mutating upload-session, R2, web-control, or cleanup state, including
after asynchronous crypto and workspace reads.

## Constraints

- Reuse the existing runtime write-fence and snapshot-session cleanup owners.
- Keep upload-session fields as target-integrity checks, not authority.
- Preserve a second fence validation immediately before checkpoint commit.
- Make upload-session creation and replaced-ref persistence conditional on the
  exact active owner inside `UserRunner`.
- Do not let a stale caller delete a session, object, or cleanup record.
- Add no state, token, dependency, compatibility path, or cleanup mechanism.

## Working Set

- `apps/cloudflare/src/runner-outbound.ts`
- `apps/cloudflare/src/user-runner/hosted-user-runner.ts`
- `apps/cloudflare/src/user-runner/workspace-snapshot-sessions.ts`
- `apps/cloudflare/src/worker/user-runner-durable-object.ts`
- `apps/cloudflare/src/worker-contracts.ts`
- `apps/cloudflare/src/worker-routes/shared.ts`
- `apps/cloudflare/test/runner-outbound.test.ts`
- `apps/cloudflare/test/user-runner-alarm.test.ts`
- `apps/cloudflare/test/runner-user-data-cleanup.test.ts`

## Verification Plan

- Focused workspace snapshot abort/completion tests.
- Cloudflare owner verification with typecheck.
- Inspect the final diff for authority ordering and accidental identifier leakage.
- Push the resolved PR head, rerun ReviewGPT immediately with CI, and continue
  until zero accepted findings.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14

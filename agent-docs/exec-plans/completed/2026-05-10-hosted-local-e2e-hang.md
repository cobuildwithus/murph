# Hosted Local E2E Hang

## Goal

Diagnose and fix the root cause of the hosted-local E2E hang observed during the Linq first-contact hosted-local flow, then prove the fix with focused hosted-local and Cloudflare verification.

## Constraints

- Do not mask the issue by only raising timeouts or skipping scenarios.
- Preserve unrelated active worktree edits and active hosted-runner rows.
- Keep logs and diagnostics redacted; do not persist local paths, secrets, raw request bodies, or provider credentials.
- Avoid branch/worktree changes.

## Current State

- Root cause identified: foreground hosted runs can advance mailbox import watermarks and intentionally defer the idle checkpoint, but the Durable Object status path only remembered `deferredCheckpointRequired` and kept reporting stale web checkpoint mailbox lag.
- The stale lag made status pollers/test harnesses nudge on already-imported mailbox items; those nudges prevented the deferred idle checkpoint from getting a quiet window.
- Implemented fix: persist only the canonical deferred-checkpoint mailbox imported-sequence fields in runner state, merge those fields into `runnerStatus()` while the deferred checkpoint is pending, and clear them when the deferred checkpoint completes.
- Focused runner-state/status tests, `pnpm test:diff`, and the targeted hosted-local Linq scenario passed.

## Investigation Plan

1. Reproduce the smallest affected hosted-local scenario with streaming logs enabled.
2. Inspect hosted-local harness, runner container, web-control, and Linq stub state to identify the exact stalled boundary.
3. Fix the underlying synchronization/runtime issue rather than adding a timeout workaround.
4. Add or update focused regression coverage.
5. Run focused verification plus required app checks.

## Verification Plan

- Passed: `pnpm exec vitest run apps/cloudflare/test/user-runner-status.test.ts apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/runner-state-store.bundle-slots.test.ts --config apps/cloudflare/vitest.node.workspace.ts --no-coverage --reporter=dot`.
- Passed: `pnpm test:diff apps/cloudflare/src/index.ts apps/cloudflare/src/legacy-runner-wake-queue.ts apps/cloudflare/src/worker-contracts.ts apps/cloudflare/test/index.test.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/runner-state-helpers.ts apps/cloudflare/src/user-runner/runner-state-schema.ts apps/cloudflare/src/user-runner/runner-state-store.ts apps/cloudflare/src/user-runner/types.ts apps/cloudflare/test/runner-state-store.bundle-slots.test.ts apps/cloudflare/test/user-runner-status.test.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/exec-plans/active/2026-05-10-hosted-local-e2e-hang.md agent-docs/exec-plans/completed/2026-05-10-cloudflare-legacy-wake-queue-removal.md`.
- Passed: `pnpm hosted-local e2e linq-first-contact` (1 file, 6 tests, 172.43s).

## Open Questions

- None for the local root cause. Live Cloudflare/iMessage verification remains part of the broader HARD_CUT goal after push and deploy.

## Working Set

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-state-helpers.ts`
- `apps/cloudflare/src/user-runner/runner-state-schema.ts`
- `apps/cloudflare/src/user-runner/runner-state-store.ts`
- `apps/cloudflare/src/user-runner/types.ts`
- `apps/cloudflare/test/user-runner-status.test.ts`
- `apps/cloudflare/test/user-runner-alarm.test.ts`
- `apps/cloudflare/test/runner-state-store.bundle-slots.test.ts`
Status: completed
Updated: 2026-05-10
Completed: 2026-05-10

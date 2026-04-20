## Title

Land greenfield reliability fixes for stale device-sync failures, hosted email raw-message durability, and retry-safe agent session rotation.

## Goal

Fix three correctness gaps that can lose ownership, block ordered hosted email draining, or permanently revoke a local device-sync agent after a lost response. The landing shape should prefer simple durable behavior over legacy-preserving complexity.

## Scope

- `packages/device-syncd/**` store/service code and focused tests for lease-fenced failure handling
- `apps/cloudflare/**`, `packages/hosted-execution/**`, and `packages/assistant-runtime/**` seams required to keep hosted email wakes terminal and unblock ordered drain when raw email is missing
- `apps/web/**` device-sync agent session service/store/routes and focused tests required to make export/refresh retry-safe

## Constraints

- Preserve unrelated dirty-tree edits, especially overlapping hosted-runtime, Cloudflare, and hosted web work already in progress.
- Keep each fix behaviorally narrow and biased toward explicit ownership, deterministic terminal handling, and replay-safe auth behavior.
- Do not add dependencies.

## Verification

- PASS `git diff --check`
- PASS `pnpm --dir packages/device-syncd typecheck`
- PASS `pnpm --dir packages/device-syncd test -- --run test/service.test.ts -t "device sync service does not fail jobs reclaimed by another worker after the original lease expires"`
- PASS `pnpm --dir packages/assistant-runtime test -- --run test/hosted-runtime-email-event.test.ts`
- PASS `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/hosted-email.test.ts apps/cloudflare/test/hosted-email-worker-ingress.test.ts apps/cloudflare/test/r2-lifecycle.test.ts apps/cloudflare/test/crypto.test.ts apps/cloudflare/test/storage-path-rotation.test.ts`
- PASS `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/user-runner-resume-finalize.test.ts -t "quarantines wakes with missing raw email payloads and keeps draining later contiguous wakes|retries when raw email validation fails for reasons other than a missing payload"`
- PASS `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/agent-session-service.test.ts apps/web/test/prisma-store-agent-session.test.ts apps/web/test/agent-route.test.ts apps/web/test/agent-session-routes.test.ts`
- PASS `pnpm --dir apps/web typecheck`
- FAIL unrelated `pnpm --dir apps/cloudflare typecheck`
  Pre-existing `HostedExecutionRuntimeTimerWake`/`HostedIngressEnvelope` fixture drift in Cloudflare tests outside this task (`test/node-runner.test.ts`, `test/node-runner-isolated.test.ts`, `test/runner-container.test.ts`, and related files).
- FAIL unrelated `pnpm test:diff ...`
  The diff-aware lane reaches `apps/cloudflare verify` and stops on the same pre-existing Cloudflare typecheck drift above.

## Notes

- Device-sync failure handling should treat stale post-lease failures like cancelled execution and must not clear another worker's lease.
- Hosted email ingress should no longer let transient raw-email expiry wedge contiguous ordered drain; missing raw data must advance via deterministic quarantine.
- Hosted email quarantine is now missing-only; other raw-email read failures bubble so the runner retries instead of permanently advancing the ordered cursor.
- Agent session export/refresh should stay recovery-safe when the server-side mutation commits but the client never receives the replacement bearer.
- Final audit follow-up added a retry-safe refresh proof for the performed-refresh + stale expected-token-version path.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20

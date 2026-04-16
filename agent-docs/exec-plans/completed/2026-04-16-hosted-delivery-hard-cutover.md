## Goal

Hard-cut hosted delivery ownership so committed hosted effects carry the outbound payload and transport metadata, while the hosted delivery journal becomes the only authoritative recovery surface for hosted non-idempotent delivery.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/assistant-engine/src/{assistant/outbox.ts,assistant/outbox/dispatch-state.ts,assistant-outbox.ts,outbound-channel.ts}`
- `packages/hosted-execution/src/side-effects.ts`
- `packages/operator-config/src/assistant-cli-contracts.ts`
- `apps/cloudflare/src/side-effect-journal.ts`
- focused tests/docs that cover the hosted delivery contract and recovery flow

## Constraints

- Keep `execution_outbox` in web as the enqueue/control-plane handoff only.
- Keep the execution journal responsible for committed result recovery only.
- Do not use local outbox state as the authoritative resend gate for hosted Telegram/email recovery.
- Treat this cut as greenfield: do not add new legacy resume or payload-reconstruction paths for pre-cutover hosted delivery records.
- Preserve unrelated in-flight `apps/web` schema/outbox work owned by other lanes.

## Verification

- Focused unit/integration tests for hosted-runtime callbacks/execution and hosted side-effects/journal behavior
- Relevant assistant-engine outbox tests for the simplified dispatcher contract
- Required repo typecheck/test coverage per task class before handoff

## Status

- Implemented the hard cut so committed hosted assistant-delivery effects now require explicit outbound payloads and transport metadata.
- Removed `deliveryStateAuthority` from the persisted outbox contract; only a read-compat strip remains for legacy local JSON.
- Reworked hosted post-commit delivery to read/write the hosted journal directly, mirror local state best-effort, and treat stale non-idempotent `sending` records as terminal `failed_ambiguous`.
- Simplified local outbox recovery so only idempotent transports keep local confirmation-pending reconciliation semantics.
- Updated hosted execution duplicate-commit checks to compare fingerprint plus committed payload, while still tolerating rotated effect ids when the durable payload is equivalent.
- Locked non-idempotent hosted replay so an existing durable `failed` journal record now terminates the effect instead of resending.
- Made hosted local mirror `sending` observations idempotent so re-reading the same in-flight journal attempt does not increment local attempt counters or append duplicate timeline events.
- Removed the dead `HOSTED_ASSISTANT_DELIVERY_EFFECT_KIND` alias and inlined the remaining local confirmation-pending helper so the cut leaves less compatibility surface behind.

## Verification Evidence

- `pnpm exec vitest run packages/hosted-execution/test/side-effects.test.ts packages/hosted-execution/test/hosted-execution-observability-side-effects.test.ts packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts packages/assistant-runtime/test/hosted-runtime-execution.test.ts packages/assistant-runtime/test/hosted-runtime-runner.test.ts --no-coverage`
- `pnpm exec vitest run packages/assistant-engine/test/assistant-outbox-runtime.test.ts packages/assistant-engine/test/outbox-dispatch-state.test.ts --no-coverage`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/execution-journal.test.ts apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/user-runner.test.ts apps/cloudflare/test/workers/runner-e2e-control.ts --no-coverage`
- `pnpm exec tsc -p packages/assistant-engine/tsconfig.typecheck.json --pretty false`
- `pnpm exec tsc -p packages/assistant-runtime/tsconfig.typecheck.json --pretty false`
- `pnpm --dir packages/hosted-execution typecheck`
- `pnpm --dir apps/cloudflare typecheck`
- `git diff --check -- packages/assistant-runtime/src/hosted-runtime/callbacks.ts packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts packages/assistant-engine/src/assistant/outbox/dispatch-state.ts packages/assistant-engine/test/outbox-dispatch-state.test.ts packages/hosted-execution/src/side-effects.ts`
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16

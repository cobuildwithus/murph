# Steered Segment Delivery Context

## Goal

Fix the PR #140 follow-up issues without broadening assistant delivery architecture:

- deliver each pre-steer final answer using the input delivery context it answered
- keep preceding-segment delivery best-effort while preserving partial session progress
- make explicit outbox dedupe tokens the whole stable identity

## Scope

- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/src/assistant/providers/*`
- `packages/assistant-engine/src/assistant/local-service.ts`
- `packages/assistant-engine/src/assistant/delivery-service.ts`
- `packages/assistant-engine/src/assistant/notification-turn.ts`
- `packages/assistant-engine/src/assistant/outbox/intents.ts`
- focused assistant-engine tests for these paths

## Constraints

- Keep delivery context in-memory for the turn; do not add persisted state.
- Keep Codex/provider segment parsing independent of Murph channel delivery details.
- Keep delivery-service responsible for sending resolved segment payloads.
- Prefer narrow typed values over a new manager or broad reply-envelope framework.
- Keep preceding replies on the typed segment primitive only; do not retain a string-only fallback that cannot carry delivery context.

## Plan

1. Add a minimal segment delivery ordinal from Codex event parsing. Done.
2. Map turn input ordinals to narrow delivery-context snapshots in local service. Done.
3. Deliver preceding segments with their resolved snapshot and continue after per-segment throws. Done.
4. Hash explicit outbox dedupe tokens independently of message/media payload drift. Done.
5. Add focused regression tests and run assistant-engine verification plus required audits. Done.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-runtime.test.ts test/assistant-local-service-runtime.test.ts test/assistant-service-runtime.test.ts test/outbox-intents.test.ts test/assistant-outbox-runtime.test.ts test/codex-thread-instructions.test.ts test/codex-runtime-helpers.test.ts` - passed, 322 tests.
- `pnpm --dir packages/assistant-engine exec tsc --noEmit --pretty false` - passed.
- `pnpm --dir packages/assistant-engine test:coverage` - passed after final notification fix, 106 files, 1275 passed, 3 skipped.
- `pnpm typecheck` - passed after final notification fix.
- `pnpm --dir packages/assistant-engine exec tsc --noEmit --pretty false` - passed after final notification fix.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-notification-turn-runtime.test.ts -t "hosted notification keys"` - passed after final notification fix, 1 passed.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-local-service-runtime.test.ts test/assistant-service-runtime.test.ts` - passed after task-finish fixes, 117 passed.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-runtime.test.ts -t "steered final segments"` - passed after simplify follow-up, 9 passed.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-local-service-runtime.test.ts test/assistant-service-runtime.test.ts test/outbox-intents.test.ts test/assistant-outbox-runtime.test.ts test/codex-thread-instructions.test.ts test/codex-runtime-helpers.test.ts` - passed after simplify follow-up, 192 passed.
- `git diff --check` - passed.
- Required completion audits:
  - simplify: accepted low finding, removed string-only preceding-reply fallback.
  - coverage-write: accepted provider-adapter bridge test.
  - deep-review: no actionable findings; residual stale media on same token reuse and unsupported media-only preceding replies noted.
  - security-privacy-review: no actionable findings; live hosted provider E2E remains manual gap.
  - task-finish-review: first pass found full active-turn delivery-context propagation gap and hosted idempotency target mismatch; both fixed. Final rerun found notification hosted-idempotency target mismatch; fixed. Focused rerun found no remaining actionable findings.
Status: completed
Updated: 2026-06-13
Completed: 2026-06-13

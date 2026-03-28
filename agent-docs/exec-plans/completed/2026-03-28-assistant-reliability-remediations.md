# Assistant Reliability Remediations

## Goal

Fix the confirmed assistant reliability bugs around session persistence, failover classification, session restoration, and failed automation prompt durability without widening into unrelated assistant refactors.

## Scope

- Serialize assistant session and index mutations under the shared assistant runtime write lock.
- Preserve the real terminal provider error when failover routes are exhausted and attach attempted-route context.
- Make missing-session restoration transcript-aware for transcript-backed providers.
- Prefer structured provider retryability/interruption traits when deciding same-turn failover eligibility.
- Persist failed auto-reply prompts as non-conversation transcript attempt records.

## Constraints

- Preserve current assistant session ids, provider-session recovery behavior, and transcript replay semantics for committed turns.
- Keep the change narrow in already-dirty assistant files, especially `packages/cli/src/assistant/service.ts`.
- Do not widen into Ink UI/controller work beyond the minimum needed to pass transcript snapshots through the existing service boundary.

## Verification

- Targeted CLI assistant tests for session locking, provider failover/recovery, and automation prompt persistence.
- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Required completion audits after implementation: `simplify`, `test-coverage-audit`, `task-finish-review`.

### Current status

- Focused verification passed:
  `pnpm exec vitest run --coverage.enabled=false packages/cli/test/assistant-state.test.ts packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-runtime.test.ts`
- Required repo checks are currently blocked by unrelated pre-existing failures outside this task scope:
  - `pnpm typecheck`: `packages/cli/src/assistant/canonical-write-guard.ts` type errors, then `packages/parsers/dist` `ENOTEMPTY`
  - `pnpm test`: `packages/contracts/dist` `ENOTEMPTY`
  - `pnpm test:coverage`: missing exports in `packages/contracts/scripts/verify.ts`
- Mandatory audit subagents completed. The final review caught and the implementation fixed the empty `transcriptSnapshot: []` restore case.

## Notes

- If a session restore has only session metadata and no transcript snapshot for a transcript-backed provider, fail closed instead of silently restoring incomplete state.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28

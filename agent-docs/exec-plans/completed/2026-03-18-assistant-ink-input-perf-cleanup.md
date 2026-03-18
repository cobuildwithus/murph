# Assistant Ink input perf cleanup

Status: completed
Created: 2026-03-18
Updated: 2026-03-18

## Goal

- Reduce avoidable live-path churn in the Ink chat so held cursor movement and busy-state updates do less work without changing chat behavior.

## Success criteria

- `ComposerInput` no longer recreates its `useInput` handler on ordinary draft and cursor updates.
- `ModelSwitcher` input handling is similarly stable across rerenders.
- Busy elapsed-time updates rerender only the status section instead of the whole Ink app tree.
- Transcript row rendering stays visually equivalent while dropping the one-entry array wrapper and spacer rows.
- Shared string normalization is reused from the assistant helper module instead of duplicated locally.
- Required repo checks and completion-workflow audits are attempted with outcomes recorded truthfully.

## Scope

- In scope:
- `packages/cli/src/assistant/ui/ink.ts`
- `packages/cli/src/assistant/ui/view-model.ts`
- focused assistant verification in `packages/cli/test/assistant-runtime.test.ts` if needed
- this execution plan and the coordination ledger while the lane is active
- Out of scope:
- broader composer-buffer or viewport-model rewrites
- moving the chat UI off Ink
- provider/session persistence or delivery behavior changes

## Constraints

- Preserve overlapping assistant Ink edits already present in the worktree.
- Keep the change local to render/input-path cleanup; no user-visible behavior changes beyond perf.
- Do not revert unrelated dirty worktree state.

## Risks and mitigations

1. Risk: ref-backed callbacks could drift from the controlled composer state and change submit/edit behavior.
   Mitigation: keep refs synchronized from props and continue clamping visible state from the controlled value effect.
2. Risk: moving the busy timer into `ChatStatus` could change the displayed elapsed time or status precedence.
   Mitigation: preserve the existing `Working`/`Working (Ns)` formatting and keep busy state dominant over status text.
3. Risk: transcript row cleanup could subtly change spacing for user messages.
   Mitigation: preserve the same content layout and replace blank spacer nodes with equivalent box padding only.

## Tasks

1. Stabilize the `ComposerInput` and `ModelSwitcher` `useInput` callbacks.
2. Localize busy elapsed-time state to `ChatStatus` and remove dead `ChatComposer` props.
3. Simplify transcript row rendering and dedupe `normalizeNullableString`.
4. Run focused plus required verification, then completion-workflow audits and commit the touched files if results are defensible.

## Decisions

- This turn will stay within the current Ink component structure instead of introducing a larger editor abstraction.
- Busy elapsed-time state belongs inside `ChatStatus` because only that subtree needs the ticker.
- The row-rendering cleanup should remain purely structural so existing tests and visual behavior stay valid.

## Verification

- Commands to run:
- `pnpm exec vitest run packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- focused assistant tests should pass
- repo-wide required checks should pass unless blocked by unrelated pre-existing failures, which must be recorded explicitly

## Results

- `pnpm exec vitest run packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1`: passed (`1` file, `29` tests)
- `pnpm --filter @healthybob/cli exec tsc --noEmit`: passed
- `pnpm typecheck`: passed
- `pnpm test`: failed outside this lane in `packages/cli/test/assistant-service.test.ts` (`maxSessionAgeMs` expectation drift), `packages/cli/test/release-script-coverage-audit.test.ts` (release-wrapper expectations), and `packages/cli/test/runtime.test.ts` (iMessage readiness requirement in inbox runtime)
- `pnpm test:coverage`: failed on the same unrelated `assistant-service`, `runtime`, and release-flow test groups, plus `packages/cli/test/release-workflow-guards.test.ts` expectations for the in-progress release workflow refactor

## Audit notes

- Simplify pass: no further behavior-preserving simplification was worth applying beyond the handler stabilization, local status timer, and single-entry row cleanup already in the diff.
- Test-coverage audit: no additional high-impact automated tests were added in this lane because the change is limited to hook identity and render-structure cleanup, the existing focused assistant-runtime suite remained green, and the current harness does not directly measure Ink listener churn or subtree rerender counts.
- Final review: no correctness or security regressions were found in the touched Ink/view-model files; residual risk is limited to the lack of an end-to-end interactive Ink perf benchmark.

Completed: 2026-03-18

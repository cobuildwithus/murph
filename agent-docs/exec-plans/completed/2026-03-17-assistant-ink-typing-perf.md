# Assistant Ink typing perf

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Make the local Healthy Bob assistant chat feel closer to Codex CLI while typing by keeping draft churn inside the composer and memoizing stable Ink subtrees.

## Success criteria

- Typing in `pnpm chat` no longer updates the top-level `App` draft state on every keystroke.
- Transcript/history/header/footer rendering is split into stable memoized sections so unchanged areas do not rerender on each character.
- Existing slash commands (`/model`, `/session`, `/exit`, `/quit`) keep their current observable behavior, including when the composer should or should not clear.
- Focused assistant tests and required repo checks are run, with unrelated repo failures recorded truthfully if they remain.

## Scope

- In scope:
- `packages/cli/src/assistant/ui/ink.ts`
- `packages/cli/src/assistant/ui/view-model.ts`
- focused assistant coverage in `packages/cli/test/assistant-runtime.test.ts`
- this execution plan and the coordination ledger while the lane is active
- Out of scope:
- changing provider/session behavior
- adding new keyboard shortcuts beyond the existing submit flow
- unrelated assistant copy/layout refresh work already in flight

## Constraints

- Technical constraints:
- Preserve overlapping `ink.ts` edits already present in the worktree.
- Keep the perf work local to the Ink render tree; do not reshape assistant persistence or provider wiring.
- Product/process constraints:
- Run the required completion workflow (`simplify`, `test-coverage-audit`, `task-finish-review`) plus repo-required checks before handoff.
- Do not revert unrelated dirty worktree state.

## Risks and mitigations

1. Risk: isolating composer state could accidentally change when slash commands clear or retain the current draft.
   Mitigation: move the submit classification into pure helpers and cover the clear/keep decisions in `assistant-runtime.test.ts`.
2. Risk: memoized history/header/footer components could drift from the current wrapped transcript layout.
   Mitigation: preserve the existing wrapped text structure inside the new memoized components and diff-review the render tree before final verification.

## Tasks

1. Add pure submit-action helpers for slash-command classification and composer-clear decisions.
2. Move the composer draft state into a local memoized component and memoize stable header/history/status/footer sections.
3. Add focused assistant tests for the submit/reset helper behavior.
4. Run focused verification, then the required repo checks and completion audits.

## Decisions

- The chat composer should clear immediately only for `/model` and real prompt sends, while `/session`, `/exit`, and ignored submits keep their prior behavior.
- A small pure helper in `view-model.ts` is preferable to embedding the new submit classification logic directly inside `ink.ts`, because it keeps the behavior testable without rendering Ink.

## Verification

- Commands to run:
- `pnpm exec vitest run --no-coverage packages/cli/test/assistant-runtime.test.ts`
- `pnpm --filter @healthybob/cli exec tsc --noEmit`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- focused assistant tests and CLI no-emit typecheck pass
- repo-wide checks should pass unless blocked by unrelated existing worktree state or repo guards, which must be recorded explicitly

## Results

- `pnpm exec vitest run --no-coverage packages/cli/test/assistant-runtime.test.ts`: passed (`1` file, `14` tests)
- `pnpm --filter @healthybob/cli exec tsc --noEmit`: passed
- `pnpm typecheck`: failed outside this lane in `packages/cli/src/inbox-services.ts` and `packages/cli/test/inbox-cli.test.ts` because `@healthybob/runtime-state` could not be resolved during the broader CLI typecheck/build flow
- `pnpm test`: failed outside this lane in `packages/cli/test/inbox-incur-smoke.test.ts` on existing inbox help-text expectations for `init` and `document` promotion commands
- `pnpm test:coverage`: failed on the same unrelated `packages/cli/test/inbox-incur-smoke.test.ts` assertions after web/package coverage work completed

## Audit notes

- Simplify pass: no further behavior-preserving simplifications were worth applying beyond the render isolation and pure submit-action helper split already in the diff.
- Test-coverage audit: the highest-impact missing coverage was the submit-action and composer-clear decision path; added focused assertions in `packages/cli/test/assistant-runtime.test.ts`.
- Final review: no assistant-lane regressions found in the touched Ink render path; residual risk is limited to the absence of an end-to-end Ink render perf benchmark in the current harness.
Completed: 2026-03-17

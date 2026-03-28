# Assistant Ink runtime simplify

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

- Simplify the Ink-backed assistant chat runtime by moving the turn/state machine out of the inline `App` render flow while preserving existing CLI UX and provider behavior.

## Success criteria

- `runAssistantChatWithInk` is materially smaller and easier to scan.
- The embedded `App` no longer owns the full queued-turn / pause / abort / replay state machine inline.
- Turn execution uses an explicit controller method or hook with typed outcomes instead of mutating scattered closure refs.
- Existing behavior around queued follow-ups, busy-status suppression, canonical write-block presentation, and composer merge/recovery remains unchanged.
- Existing assistant Ink tests pass, and any new tests stay focused on extracted pure state logic.
- Required repo checks are run and reported truthfully.

## Scope

- In scope:
- `packages/cli/src/assistant/ui/ink.ts`
- targeted `packages/cli/test/assistant-runtime.test.ts`
- this execution plan and the coordination ledger while the lane is active
- Out of scope:
- provider/service semantic changes
- transcript rendering redesign
- unrelated assistant runtime or CLI command-surface work

## Constraints

- Preserve existing transcript and composer UX exactly unless a change is purely structural.
- Keep queue replay, busy-status visibility, model switching, pause/recovery, and canonical write-block behavior stable.
- Do not revert unrelated worktree edits.

## Risks and mitigations

1. Risk: extracting the controller could subtly change prompt queue replay or pause semantics.
   Mitigation: keep queue mutations explicit, typed, and covered by existing behavior-anchor tests plus any narrow new pure-state tests.
2. Risk: moving turn orchestration out of the component could desynchronize session refs or busy state.
   Mitigation: centralize turn completion outcomes and state transitions behind a small controller reducer/helper layer.
3. Risk: refactor sprawl inside one already-large file could add more abstraction than it removes.
   Mitigation: keep rendering components dumb, extract only the state machine and related helpers, and run the required simplify audit pass before handoff.

## Tasks

1. Extract a controller hook/helper for prompt queue, turn lifecycle, pause/abort, and transcript/status updates.
2. Replace inline `startPromptTurn` closure mutation with a typed standalone turn runner/controller method.
3. Keep the render tree thin and feed it controller-owned state/actions.
4. Add focused tests for extracted pure helper/reducer behavior if the new seam introduces untested logic.
5. Run required checks and required audit passes, then close the plan on completion.

## Decisions

- Keep the refactor local to `ink.ts` unless a second file materially reduces complexity.
- Prefer explicit turn-state and outcome types over more boolean refs.
- Favor behavior-preserving helper extraction over changing public or service-layer interfaces.

## Verification

- Commands to run:
- `pnpm exec vitest run packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- focused assistant runtime coverage should stay green
- repo-wide checks may surface unrelated existing failures and must be reported if they block clean green completion
Completed: 2026-03-28

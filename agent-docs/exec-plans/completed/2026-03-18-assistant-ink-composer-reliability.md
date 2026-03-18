# Assistant Ink composer reliability

Status: completed
Created: 2026-03-18
Updated: 2026-03-18

## Goal

- Fix the remaining assistant Ink composer reliability regressions around multiline vertical cursor movement, bursty paste input, and terminal backspace handling.

## Success criteria

- Up/down cursor movement works across multiline drafts and preserves the intended column when line lengths differ.
- Large pasted text applies against the freshest in-flight composer state so the visible caret does not lag behind the inserted text as parent state catches up.
- Raw terminal DEL bytes are treated as backward delete input in the composer.
- Focused assistant runtime tests cover vertical movement and raw DEL handling alongside the existing composer coverage.
- Required repo checks are attempted and outcomes are recorded truthfully.

## Scope

- In scope:
- `packages/cli/src/assistant/ui/ink.ts`
- `packages/cli/test/assistant-runtime.test.ts`
- this execution plan and the coordination ledger while the lane is active
- Out of scope:
- broader composer architecture rewrites such as extracting a dedicated buffer model
- transcript/history compaction or command-palette work
- unrelated dirty worktree state

## Constraints

- Preserve overlapping assistant-lane edits already in flight.
- Keep the fix local to the current composer input/render logic and focused tests.
- Do not revert or clean up unrelated worktree changes.

## Risks and mitigations

1. Risk: in-flight refs could drift from parent-controlled state and leave the composer visually inconsistent.
   Mitigation: clamp refs back to the controlled value on prop changes and only prefer the ref-backed display value while parent state is catching up to a prefix append.
2. Risk: vertical cursor logic could break edge cases at document boundaries or around empty lines.
   Mitigation: keep the movement logic line-range based, clamp offsets, and add focused assertions for uneven-line movement.
3. Risk: terminal-specific delete handling could collide with explicit forward-delete semantics.
   Mitigation: normalize only raw unmodified DEL/backspace bytes and keep Ctrl+D routed through the existing forward-delete path.

## Tasks

1. Add a narrow ledger row and keep scope current while the lane is active.
2. Patch the composer input path to use in-flight refs, vertical cursor movement, and raw DEL normalization.
3. Add focused assistant runtime tests for vertical movement and raw DEL handling.
4. Run completion workflow audits and required verification, then commit only the touched files if the results are defensible.

## Decisions

- The immediate fix will stay inside the existing `ink.ts` composer model rather than introducing a larger `ComposerBuffer` extraction in this turn.
- Vertical movement will preserve a preferred column across repeated up/down navigation, matching multiline editor expectations.
- The live composer render may prefer the ref-backed value briefly when a paste burst outruns React re-rendering, but only for prefix-appended in-flight text.

## Verification

- Commands to run:
- `pnpm exec vitest run packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- focused assistant tests should pass
- full repo checks should pass unless an unrelated pre-existing failure remains outside the touched assistant composer files
Completed: 2026-03-18

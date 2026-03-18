# Assistant Ink composer paste fix

Status: completed
Created: 2026-03-18
Updated: 2026-03-18

## Goal

- Keep the Ink-backed assistant chat composer stable when dictation tools or terminal paste insert larger wrapped or multiline text blocks.

## Success criteria

- Large pasted or dictated text no longer corrupts the chat composer layout.
- Carriage-return paste input is normalized before it reaches the rendered composer state.
- The composer render path keeps cursor display stable around wrapped and multiline content.
- Focused assistant runtime tests cover the pasted newline normalization and newline-adjacent cursor rendering behavior.
- Required repo checks are attempted and outcomes are recorded truthfully.

## Scope

- In scope:
- `packages/cli/src/assistant/ui/ink.ts`
- `packages/cli/src/assistant-chat-ink.ts`
- `packages/cli/test/assistant-runtime.test.ts`
- this execution plan and the coordination ledger while the lane is active
- Out of scope:
- unrelated assistant provider/session behavior
- broader terminal UX changes outside the composer render/input path
- unrelated dirty worktree state

## Constraints

- Preserve overlapping assistant-lane edits already in flight.
- Keep the fix local to the Ink composer input/render path and focused tests.
- Do not revert or clean up unrelated worktree changes.

## Risks and mitigations

1. Risk: changing composer rendering could regress cursor visibility or placeholder behavior.
   Mitigation: keep the existing cursor/placeholder palette, add focused render assertions, and avoid broader transcript/footer changes.
2. Risk: paste normalization could accidentally strip intended multiline content.
   Mitigation: normalize carriage returns to `\n` instead of flattening line breaks.
3. Risk: repo-wide check failures from the already-dirty tree could obscure this small fix.
   Mitigation: run focused assistant tests first, then rerun the required repo checks and record unrelated blockers precisely if they remain.

## Tasks

1. Normalize pasted carriage returns before composer insertion.
2. Refactor composer rendering so wrapped and multiline text stays in a stable layout flow.
3. Add focused assistant runtime tests for the new input/render behavior.
4. Run required checks, then commit only the scoped files if unrelated failures remain outside this lane.

## Decisions

- Preserve multiline content by converting `\r\n` and bare `\r` to `\n` rather than removing line breaks.
- Keep cursor styling inside the existing composer palette instead of changing the UI theme.
- Narrow `assistant-chat-ink.ts` back to exporting only the runtime entrypoint so test helpers added in `ink.ts` do not leak through the wrapper module.

## Verification

- Commands to run:
- `pnpm exec vitest run packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1`
- `pnpm --dir packages/cli typecheck`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- focused assistant tests and CLI typecheck pass
- full repo checks should pass unless an unrelated pre-existing worktree issue remains outside the touched assistant composer files
Completed: 2026-03-18

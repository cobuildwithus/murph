# Assistant chat render perf

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Reduce perceived typing latency in the Ink-backed Healthy Bob chat by keeping immutable transcript rows out of the live rerender path.

## Success criteria

- Typing in `pnpm chat` no longer causes existing transcript rows to participate in dynamic Ink rerenders.
- Existing slash-command, submit, model-switcher, and session/result behavior stays unchanged.
- Focused assistant tests pass and required repo checks are attempted with outcomes recorded truthfully.

## Scope

- In scope:
- `packages/cli/src/assistant/ui/ink.ts`
- focused assistant coverage in `packages/cli/test/assistant-runtime.test.ts`
- this execution plan and the coordination ledger while the lane is active
- Out of scope:
- provider/session persistence behavior
- broader chat copy/layout refresh work already in flight
- new keyboard shortcuts or command semantics

## Constraints

- Preserve overlapping active assistant Ink UI edits already in flight.
- Keep the change local to the render path; do not reshape assistant runtime/provider behavior.
- Do not revert unrelated dirty worktree state.

## Risks and mitigations

1. Risk: moving transcript rows to Ink `Static` output could change the visible ordering or spacing of chat turns.
   Mitigation: reuse the same row renderer and keep the composer/status/footer in the live subtree only.
2. Risk: static transcript rendering could accidentally hide newer rows or break error/user styling.
   Mitigation: keep the existing row styling intact and review the render diff carefully.
3. Risk: repo-wide pre-existing failures may still block green acceptance signals.
   Mitigation: run focused assistant tests plus the required repo checks and record any unrelated failures exactly.

## Tasks

1. Replace the live transcript list with Ink `Static` rendering for immutable chat rows.
2. Keep the row renderer behaviorally identical for assistant, user, and error entries.
3. Run required checks, then completion-workflow audits, and hand off with exact outcomes.

## Decisions

- Prioritize render-path changes over new provider/runtime work because the user complaint is interactive typing latency, not response generation latency.
- Prefer Ink `Static` over more memoization because it removes old transcript rows from future dynamic renders entirely.
- Keep the header and banner inside the static feed too, so Ink preserves the intended ordering while only the live status/composer/footer subtree rerenders.

## Verification

- Commands run:
- `pnpm exec vitest run packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1`
- `pnpm --dir packages/cli typecheck`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Results

- `pnpm exec vitest run packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1`: passed (`1` file, `18` tests)
- `pnpm --dir packages/cli typecheck`: passed
- `pnpm typecheck`: passed
- `pnpm test`: failed outside this lane in `packages/web/test/overview.test.ts` because the web-package Vitest run could not resolve the `@healthybob/contracts` package entry from query imports
- `pnpm test:coverage`: failed on the same unrelated `packages/web/test/overview.test.ts` package-resolution error after doc gardening and package coverage setup completed

## Audit notes

- Simplify pass: no further behavior-preserving simplification was worth applying beyond replacing the live transcript list with the static feed and keeping the existing row renderer.
- Test-coverage audit: the change is isolated to Ink render-path structure; existing focused assistant-runtime coverage remained sufficient for the preserved submit/session behavior, so no new helper tests were required.
- Final review: no assistant-runtime or provider-semantic regressions found in the touched diff; residual risk is limited to the absence of an end-to-end interactive Ink perf benchmark in the current harness.

Completed: 2026-03-17

# Computer-Use ReviewGPT Round 7 Fix

## Goal

Resolve accepted ReviewGPT round 7 finding on PR 214: after
`computer_pause_for_user` durably pauses a run and messages the user, a fast
user reply must not be live-steered into the still-open Codex turn.

## Constraints

- Keep the fix at the existing active-turn boundary.
- Prefer the existing `closeLiveTurn` primitive over new state or queues.
- Do not change the durable computer-run checkpoint API.
- Keep tests focused on the pause/resume race.

## Working Set

- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/test/assistant-codex-runtime.test.ts`
- focused assistant-engine tests

## Verification Plan

- Focused regression test for `computer_pause_for_user` closing live steering.
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm exec vitest run packages/assistant-engine/test/assistant-codex-runtime.test.ts`
- `git diff --check` and privacy/path scan.
- Push and rerun ReviewGPT.

## Current State

- Round 7 was recaptured from ChatGPT thread export after the wait command exited non-zero.
- ReviewGPT finding is accepted after static code-path inspection.
- The first local security review found a real buffered pre-start pause gap:
  `closeLiveTurn()` could run before live steering was registered, and a later
  `registerLiveTurn()` could reopen steering.
- The pause lock now closes any current live turn and blocks later live-turn
  registration for the same provider turn.

## Verification Notes

- `pnpm exec vitest run packages/assistant-engine/test/assistant-codex-runtime.test.ts -t "computer pause"` passed.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistant-engine test:coverage` passed: 110 files,
  1409 tests passed, 3 skipped.
- `security-privacy-review` accepted one medium buffered pre-start finding;
  fixed with the terminal pause-lock guard and a pre-start regression test.
- Security rerun found no remaining medium-or-higher findings.
- `coverage-write` tightened the focused pause test to prove live steering is
  closed while the pause API request is still in flight.
- `deep-review` found no production-breaking issues; noted residual risk that
  a broader hosted mailbox end-to-end test would be stronger than the scoped
  controller/runtime proof.
- `git diff --check` passed.
- Privacy/path scan over the diff found no local personal identifiers or
  private local paths.
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18

# Assistant Ink keybindings

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Make the local Ink chat composer feel closer to terminal-native editors by supporting common cursor, word, and line-editing shortcuts instead of only single-character insert/delete.

## Success criteria

- The composer supports shell-style cursor movement and deletion shortcuts that Ink can receive reliably.
- Best-effort `Cmd` mappings are enabled only when Ink exposes `super` events, without breaking normal terminals that never send them.
- Focused tests cover the editing helper behavior, including word movement, word deletion, line kills, forward delete, and yank behavior if added.
- Required repo checks are attempted and their outcomes are recorded truthfully.

## Scope

- In scope:
- `packages/cli/src/assistant/ui/ink.ts`
- focused assistant runtime tests that exercise extracted/pure composer editing behavior
- this execution plan and the coordination ledger while the lane is active
- Out of scope:
- multiline editor behavior
- broader assistant runtime/session behavior
- terminal emulator configuration outside this repo

## Constraints

- Preserve overlapping assistant Ink changes already in the worktree.
- Keep the implementation local to the chat composer and helper logic.
- Do not claim universal raw macOS `Cmd` support; standard terminals often do not forward those chords.

## Risks and mitigations

1. Risk: Adding many keybindings inline could make the composer logic brittle.
   Mitigation: route editing through small pure helpers and add focused tests around the helper behavior.
2. Risk: Treating `Delete` like `Backspace` would keep forward-delete broken.
   Mitigation: separate backward-delete and forward-delete behavior explicitly.
3. Risk: Meta/Option handling varies across terminals.
   Mitigation: support multiple compatible paths (`Alt+Arrow`, `Alt+b/f/d`, `Alt+Backspace`) and keep `super` support best-effort only.

## Tasks

1. Inspect Ink key metadata and Codex CLI editor behavior to identify the viable shortcut set.
2. Implement terminal-native single-line editing helpers for cursor movement, word movement, delete/kill, and yank.
3. Wire those helpers into the assistant Ink composer without changing submit/session flows.
4. Add focused tests, run completion workflow checks plus required repo verification, then commit only the scoped files.

## Decisions

- Mirror Codex CLI’s terminal-native behavior where it fits a single-line Ink composer: `Ctrl+A/E/B/F/D/H/U/K/W/Y`, `Home/End`, `Alt+Backspace/Delete`, `Alt+b/f`, and `Alt+Left/Right`.
- Treat `Delete` as forward delete and `Backspace` as backward delete.
- Map `Cmd` shortcuts only through Ink’s `super` flag, which is only available under kitty keyboard protocol.

## Verification

- Commands to run:
- `pnpm exec vitest run packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1`
- `pnpm --filter @healthybob/cli exec tsc --noEmit`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- focused assistant tests and package typecheck pass
- full repo checks may still surface unrelated pre-existing failures outside the touched assistant Ink files
- Actual outcomes:
- `pnpm exec vitest run packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1` passed.
- `pnpm --filter @healthybob/cli exec tsc --noEmit --pretty false` passed.
- `pnpm typecheck` passed.
- `pnpm test` failed in `packages/cli/test/inbox-incur-smoke.test.ts` because two existing help-text assertions no longer match the current CLI command surface.
- `pnpm test:coverage` failed for the same two existing `packages/cli/test/inbox-incur-smoke.test.ts` assertions.
- Simplify, coverage, and final review passes found no additional assistant Ink issues beyond the implemented shortcut coverage.
Completed: 2026-03-17

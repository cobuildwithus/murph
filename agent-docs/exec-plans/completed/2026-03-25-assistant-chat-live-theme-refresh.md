# Assistant chat live theme refresh

Status: completed
Created: 2026-03-25
Updated: 2026-03-25

## Goal

- Make already-open Healthy Bob Ink chat sessions react when macOS appearance flips after launch, so the transcript/composer/footer can switch between light and dark palettes without restarting the chat.

## Success criteria

- An Ink chat started while macOS is in light mode can switch to the dark palette after the system appearance flips to dark.
- The launch-time terminal hint still controls the initial palette selection.
- Manual terminal/theme hints are not overridden unless the system appearance actually changes after launch.
- Focused assistant theme tests pass.
- Required repo checks are rerun and their outcomes are recorded truthfully.

## Scope

- In scope:
- `packages/cli/src/assistant/ui/theme.ts`
- `packages/cli/src/assistant/ui/ink.ts`
- focused regression coverage in `packages/cli/test/assistant-chat-theme.test.ts`
- this execution plan and the coordination ledger while the lane is active
- Out of scope:
- broader Ink layout/status-copy work already active in adjacent lanes
- non-macOS terminal theme probing beyond the existing startup behavior
- changes to the web package or browser-based theme handling

## Constraints

- Technical constraints:
- Preserve the existing light/dark palette tokens.
- Keep startup precedence for terminal hints vs macOS appearance intact.
- Avoid introducing a heavier terminal-query protocol or browser-style theme store for this narrow fix.
- Product/process constraints:
- Preserve overlapping `ink.ts` edits already in flight.
- Do not revert unrelated dirty worktree state.
- Run the required repo verification commands before handoff.

## Risks and mitigations

1. Risk: a live refresh could incorrectly override a manually chosen terminal theme.
   Mitigation: only override the launch hint when macOS appearance differs from its launch-time value; otherwise keep the launch hint.
2. Risk: polling for appearance changes could add noisy or unnecessary churn in the Ink render loop.
   Mitigation: restrict the refresh loop to the macOS path and only update state when the resolved mode actually changes.
3. Risk: the repo-wide verification gate can fail before tests run because the worktree is already large and busy.
   Mitigation: keep this active plan file in place during verification and record any remaining unrelated failures precisely.

## Tasks

1. Capture launch-time assistant chat theme inputs once at Ink startup.
2. Add a narrow helper that resolves the correct theme for an already-open macOS chat when appearance changes after launch.
3. Thread theme through Ink component state instead of keeping it as a one-time constant.
4. Add focused regression tests for launch hints, dark-after-launch switching, and return-to-launch-mode behavior.
5. Run focused verification first, then rerun the required repo checks.

## Decisions

- Use a small macOS-only refresh interval in the Ink app instead of adding a deeper terminal-color query path.
- Keep the initial terminal background hint as the startup source of truth, but let post-launch macOS appearance changes override it when the system mode changes from the launch state.

## Verification

- Commands to run:
- `pnpm exec vitest run packages/cli/test/assistant-chat-theme.test.ts --maxWorkers 1 --coverage=false`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- the focused assistant theme test passes
- repo-wide checks pass, or any unrelated pre-existing failures are called out explicitly with why this diff did not cause them
Completed: 2026-03-25

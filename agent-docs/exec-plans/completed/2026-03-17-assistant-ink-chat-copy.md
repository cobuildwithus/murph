# Assistant Ink chat copy cleanup

Status: active
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Remove duplicated wait/thinking copy from the Ink-backed assistant chat UI so one in-flight turn reads cleanly instead of repeating the same status in multiple places.

## Success criteria

- Busy assistant chat state shows one clear in-flight status instead of duplicated waiting/thinking phrases across multiple UI regions.
- The seeded system copy is shorter and less repetitive.
- Focused assistant chat tests cover the new transcript/status copy.
- Required repo checks are attempted and their outcomes are recorded truthfully.

## Scope

- In scope:
- `packages/cli/src/assistant/ui/ink.ts`
- small assistant-chat view-model helpers used only by the Ink UI
- focused assistant chat tests
- this execution plan and the coordination ledger while the lane is active
- Out of scope:
- broader assistant runtime/provider behavior
- session persistence semantics
- unrelated existing assistant CLI/runtime failures already present in the tree

## Constraints

- Preserve overlapping assistant-lane edits already in flight.
- Keep the change local to the Ink UI and its tests.
- Do not revert or clean up unrelated dirty worktree state.

## Risks and mitigations

1. Risk: Busy-state cleanup could make the chat feel inert if all status text disappears.
   Mitigation: keep one explicit assistant-status line while removing the redundant prompt/placeholder/footer phrasing.
2. Risk: A new helper file could drift from the UI usage.
   Mitigation: route the Ink component through the helper and cover the helper output directly in an included assistant test file.
3. Risk: Repo-wide red tests outside this lane can block final verification.
   Mitigation: run the full required checks anyway and record exact unrelated failures if they remain outside the touched files.

## Tasks

1. Collapse duplicated busy-state copy in the Ink assistant chat UI.
2. Shorten the seeded system message without changing runtime/session behavior.
3. Add focused assertions for the new helper/view-model behavior.
4. Run required checks, then commit only the scoped files if any repo failures remain unrelated.

## Decisions

- Use one dim assistant-status line during busy state instead of also mutating the prompt label, placeholder, and footer into “wait” copy.
- Keep the footer informational during busy state rather than turning it into a second waiting indicator.
- Keep the session banner intact; only the repeated waiting/system copy is in scope for this pass.

## Verification

- Commands to run:
- `pnpm exec vitest run packages/cli/test/assistant-runtime.test.ts packages/cli/test/assistant-cli.test.ts --no-coverage --maxWorkers 1`
- `pnpm --dir packages/cli typecheck`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- focused assistant tests and package typecheck pass
- full repo checks may still surface unrelated pre-existing failures outside the touched Ink UI files

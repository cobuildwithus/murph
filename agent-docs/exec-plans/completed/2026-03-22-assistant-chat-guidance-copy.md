# Assistant chat guidance copy refresh

Status: completed
Created: 2026-03-22
Updated: 2026-03-22

## Goal

- Make the Ink-backed assistant chat feel health-specific on first open, then get out of the way after the first sent message.

## Success criteria

- Starter suggestions use health-oriented copy instead of generic coding prompts.
- The composer hint and `try:` suggestions render only before the chat has any transcript entries.
- The user-side `you` label no longer renders in the composer or transcript rows.
- Focused assistant UI tests cover the new helper behavior.
- Required repo checks are attempted and their outcomes are recorded truthfully.

## Scope

- In scope:
- `packages/cli/src/assistant/ui/view-model.ts`
- `packages/cli/src/assistant/ui/ink.ts`
- focused assertions in `packages/cli/test/assistant-runtime.test.ts`
- this execution plan and the coordination ledger while the lane is active
- Out of scope:
- broader assistant session/runtime/provider behavior
- unrelated existing CLI/package failures outside the assistant UI files

## Constraints

- Preserve overlapping assistant UI/runtime edits already in flight.
- Keep the change local to copy and lightweight visibility logic.
- Do not revert unrelated dirty worktree changes.

## Risks and mitigations

1. Risk: Hiding guidance too aggressively could remove useful onboarding for empty resumed chats.
   Mitigation: key the visibility to transcript entry count so blank chats still show guidance, while any existing conversation hides it.
2. Risk: Removing the user label could make assistant vs. user rows harder to scan.
   Mitigation: keep the user row chrome and the `›` composer prompt while only dropping the redundant label text.
3. Risk: Full repo verification may still fail in unrelated active lanes.
   Mitigation: run the required commands anyway and record exact unrelated failures if they remain outside this scope.

## Tasks

1. Update the starter suggestion copy to fit Healthy Bob's health-oriented chat surface.
2. Hide composer guidance after the first transcript entry.
3. Remove the user-facing `you` role label.
4. Add focused assertions for the helper-driven visibility and label behavior.
5. Attempt required repo verification and capture any unrelated blockers.

## Decisions

- Keep the composer hint text unchanged for the pre-message state; only its visibility changes.
- Use pure helper functions for the new visibility/label rules so the behavior can be asserted directly without deep Ink renderer coupling.
- Treat unrelated assistant-lane worktree failures as blockers to record, not code to rewrite opportunistically.

## Verification

- Commands to run:
- `pnpm exec vitest run --coverage.enabled=false packages/cli/test/assistant-runtime.test.ts`
- `pnpm --dir packages/cli typecheck`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- focused assistant test passes
- full repo checks may still surface unrelated pre-existing failures outside the touched assistant UI files
Completed: 2026-03-22

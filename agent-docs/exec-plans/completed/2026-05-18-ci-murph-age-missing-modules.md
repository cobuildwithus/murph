# CI Murph Age Missing Modules

## Goal

Fix GitHub Actions run `26048628103` by restoring the Murph Age TypeScript module closure that clean CI checkouts need.

Success criteria:

- The tracked Murph Age scripts no longer import local sibling modules that are absent from git.
- The committed closure includes the focused tests that already exist beside those modules.
- Focused Murph Age verification and full typecheck pass, or any blocker is clearly unrelated to this scoped closure.
- The final commit contains only the plan closeout and the missing Murph Age module/test files needed by this CI fix.

## Context

The failed `Release build/typecheck (ubuntu)` job reports `TS2307` module-not-found errors from tracked files under `scripts/murph-age/**`.

Local analysis found that the referenced files exist in the worktree as untracked files. The fix is to commit the narrow dependency closure currently imported by tracked Murph Age entrypoints, plus the `r1082` command module referenced by the current loop, not to rewrite the research architecture or change behavior.

## Scope

Include the current clean-checkout dependency closure in:

- `scripts/murph-age/r1068*` through `scripts/murph-age/r1084*` for the NSRR/true-wearable path imported or command-referenced by the current loop.
- `scripts/murph-age/r1150*` through `scripts/murph-age/r1176*` for the ordinary-consumer safe-confirmation/assertion path imported by the current loop and completion audit.

Do not include unrelated untracked Murph Age files outside the discovered closure.

## Verification Plan

- Run the clean-checkout import-closure script against tracked files plus the intended commit set.
- Run focused Murph Age tests for the committed closure and the previously failing importers.
- Run `pnpm typecheck`.
- Run completion audits appropriate for this scoped code/test change.
Status: completed
Updated: 2026-05-18
Completed: 2026-05-18

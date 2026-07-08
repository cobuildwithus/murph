# CLI Output Budget Follow-Up

## Goal

Close the remaining default CLI output-budget gaps found by measuring a private full vault, and add a durable regression guard so new agent-visible read surfaces do not grow without an explicit drilldown path.

## Constraints

- Treat the private vault as local measurement input only; commit no vault content, derived record text, paths, identifiers, or raw outputs.
- Keep `--llms-full` and framework-owned discovery/schema surfaces unchanged.
- Prefer default summary limits and compact status rows over new data stores or broad abstractions.
- Preserve full operator access through detail commands, explicit limits, or internal persisted data.

## Plan

1. Patch the remaining over-budget default surfaces: assistant status, workout list, and wearable sleep list.
2. Add focused regression coverage for default agent-visible output budgets and assistant status compaction.
3. Document the bounded-output invariant for future CLI surfaces.
4. Re-run focused verification and remeasure the private vault using aggregate character counts only.
5. Commit and update the existing PR branch.

## Verification

- Focused assistant status tests.
- Focused CLI output budget tests.
- `pnpm typecheck`.
- Private full-vault aggregate character-count smoke for representative default read commands.

## State

Implemented 2026-07-08.

- `assistant status` now returns compact recent-turn summaries instead of full receipt timelines.
- `workout list` defaults to 5 rows; wearable daily list commands default to 3 rows.
- Added CLI output-budget regression coverage and assistant status timeline compaction coverage.
- Added the default CLI output-budget invariant to the contracts.
- Private full-vault aggregate smoke passed with all measured default reads under 15k chars; largest measured outputs were `assistant status` at 13,742 chars and `wearables sleep list` at 13,362 chars.
- Focused assistant, CLI, and vault-usecases tests passed; repo-level `pnpm typecheck` passed.
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08

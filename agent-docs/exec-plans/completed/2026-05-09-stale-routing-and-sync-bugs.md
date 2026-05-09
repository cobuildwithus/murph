# Stale routing and sync bug fixes

Status: completed
Created: 2026-05-09
Updated: 2026-05-09

## Goal

- Review and fix the five reported bugs with the smallest durable changes:
  - stale process-local assistant index cache splitting session routing
  - case-sensitive knowledge source root denylist
  - invalid journal link input creating a day before failing
  - automation upserts clearing tags when tags are omitted
  - Oura sync accumulating unbounded paginated records

## Success criteria

- Assistant session routing observes cross-process index updates instead of relying on stale process-local cache state.
- Knowledge source root denylist matching is case-insensitive.
- Journal link validation fails before any journal day is created or mutated.
- Automation upserts preserve existing tags when the caller omits tags.
- Oura pagination is bounded and fails explicitly on provider pagination loops.
- Focused tests cover the fixed behaviors, with required scoped verification run or blocked only by unrelated dirty work.

## Scope

- `packages/assistant-engine/src/assistant/store/persistence.ts`
- `packages/assistant-engine/src/knowledge/service.ts`
- `packages/core/src/domains/journal.ts`
- `packages/core/src/automation.ts`
- `packages/device-syncd/src/providers/oura.ts`
- focused owner tests for those files

## Constraints

- Preserve unrelated dirty work already present in the checkout.
- Avoid new broad state abstractions or compatibility shims.
- Keep validation and pagination logic local to the existing owners.
- Do not log raw vault content, health data, identifiers, secrets, or local paths.

## Risks and mitigations

1. Risk: assistant index cache changes could add unnecessary I/O.
   Mitigation: remove the process-local cache for the small routing index because stale routing is costlier than rereading this correctness-critical file.
2. Risk: journal validation changes could drift from existing CLI input parsing.
   Mitigation: reuse the current validation helpers and move validation earlier.
3. Risk: Oura pagination bounds could truncate valid provider responses.
   Mitigation: set a conservative high bound and fail explicitly only on missing progress or excessive pages.

## Verification

- Passed: focused assistant-engine tests for session-index freshness and knowledge source policy.
- Passed: focused core tests for automation tag preservation and journal link prevalidation.
- Passed: focused Oura provider test.
- Passed: `pnpm typecheck`.
- Passed: owner coverage for `packages/assistant-engine`, `packages/core`, and `packages/device-syncd`.
- Passed: `git diff --check` scoped to this task's files.
- Scoped `test:diff` note: rerun progressed through assistant-cli and assistant-engine, then stopped on an assistant-runtime temp-directory cleanup `ENOTEMPTY`; the single failing test and full `packages/assistant-runtime` test suite both passed on rerun.
Completed: 2026-05-09

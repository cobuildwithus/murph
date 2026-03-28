# CLI Record Edit/Delete

Status: completed
Created: 2026-03-27
Updated: 2026-03-28

## Goal

- Add a shared CLI mutation surface for partial record edits (`--input`, repeated `--set`, repeated `--clear`) and first-class `edit`/`delete` commands for the missing health record surfaces.
- Keep canonical write ownership in `packages/core`, including real event rewrites and record deletes instead of CLI-side file surgery.

## Success criteria

- `document`, `meal`, `workout`, `intervention`, `food`, `provider`, `recipe`, and generic `event` expose first-class `edit` and `delete` commands.
- Edit flows support JSON patch input plus repeated path assignment/clear flags without changing canonical ids.
- Event edits actually rewrite the canonical event ledger entry, including month-shard moves when `occurredAt` changes.
- Event-backed edits never silently keep a stale `dayKey` after `occurredAt`/`timeZone` changes and never persist the vault fallback timezone into legacy records unless the user explicitly sets `timeZone`.
- Core supports delete operations for canonical events plus the targeted markdown registries touched by the new CLI verbs.
- Command metadata, generated CLI surfaces, and focused regression tests stay aligned with the final command graph and result shapes.

## Scope

- In scope:
- shared CLI record-patch helpers and event-mutation helpers
- CLI command wiring and manifest/typegen updates for the targeted nouns
- core event rewrite/delete plumbing and targeted markdown-registry delete helpers
- the meal event contract extension needed for post-hoc `ingredients`
- focused tests for edit/delete behavior at the CLI and core boundaries
- Out of scope:
- new nouns beyond the ones requested in the supplied patch
- broad registry/api refactors beyond the minimum shared delete seam
- unrelated assistant, inbox, hosted, or web changes already in the worktree

## Constraints

- Preserve current adjacent dirty work, especially the active food/provider/generated CLI lanes.
- Keep canonical writes in `packages/core`; CLI use-cases may orchestrate and validate patches but must not mutate vault files directly.
- Reuse existing registry/write-batch abstractions where they already fit instead of layering parallel helpers.
- Run the required repo verification plus the mandatory `simplify`, `test-coverage-audit`, and `task-finish-review` subagent passes before handoff.

## Risks and mitigations

1. Risk: event edits silently no-op because upsert still only detects existing ids.
   Mitigation: make `packages/core/src/domains/events.ts` rewrite matched records and re-stage affected shards explicitly.
2. Risk: clear semantics drift across markdown registries and event payloads.
   Mitigation: keep one shared CLI patch helper and translate cleared top-level fields into the narrow core input resets each noun already understands.
3. Risk: generated CLI metadata diverges from the real command graph.
   Mitigation: regenerate or update `incur.generated.ts` and command-manifest surfaces from the final registered commands, not from the stale patch.
4. Risk: time edits remain ambiguous for legacy records that have `dayKey` but no stored `timeZone`.
   Mitigation: require an explicit edit policy (`keep` or `recompute`) whenever `occurredAt`/`timeZone` changes without an explicit `dayKey`, and reject recomputation when no explicit timezone provenance exists.

## Outcome

- Added shared CLI record mutation helpers plus first-class `edit` and `delete` verbs for `document`, `meal`, `workout`, `intervention`, `food`, `provider`, `recipe`, and generic `event`.
- Landed canonical core delete plumbing for event/food/provider/recipe and fixed event rewrites so id-based edits actually replace the stored ledger entry, including month-shard moves.
- Added a fast append path for brand-new generic events so new writes no longer scan every historical shard.
- Extended the meal event contract so later edits can add `ingredients`.

## Verification

- Focused package checks passed:
  - `pnpm --dir packages/cli exec tsc -p tsconfig.typecheck.json --pretty false --noEmit`
  - `pnpm --dir packages/core exec tsc -p tsconfig.json --pretty false --noEmit`
  - `pnpm exec vitest run packages/cli/test/record-mutations.test.ts packages/cli/test/cli-expansion-document-meal.test.ts packages/cli/test/cli-expansion-intervention.test.ts packages/cli/test/cli-expansion-provider-event-samples.test.ts packages/cli/test/cli-expansion-workout.test.ts packages/core/test/core.test.ts --no-coverage --maxWorkers 1`
- Required audit passes completed:
  - `simplify`: surfaced nested-clear semantics and generic-event kind-boundary regressions; both fixed
  - `test-coverage-audit`: added helper-level record-mutation coverage and duplicate-event delete coverage
  - `task-finish-review`: flagged the brand-new-event fast-path regression in core event upsert; fixed and re-reviewed with no further actionable issues
- Repo wrappers remain red outside this lane:
  - `pnpm typecheck` and `pnpm test` fail in unrelated `apps/web` hosted-onboarding files
  - `pnpm test:coverage` reaches unrelated broad-suite failures and a later Vitest coverage temp-file ENOENT outside the focused CLI/core slice

## Follow-up review

- Goal: perform a thorough post-landing audit of the new edit/delete functionality, fix any real bugs found, and extend focused regressions only where they close a confirmed hole.
- Findings fixed:
  - `food edit --set slug=...` now threads `allowSlugRename` through the CLI mutation path so slug edits actually rename the canonical record file.
  - `recipe edit --set slug=...` now threads `allowSlugRename` through the CLI/core recipe path so slug edits no longer silently leave the old file in place.
  - Provider edits now keep default templated markdown bodies aligned when `note` or `title` changes, and `--clear body` regenerates the template with the current note instead of dropping it.
- Follow-up regression proof:
  - isolated provider/food/recipe regression run passed after the fixes, including slug rename coverage and provider default-body sync/reset coverage
  - added explicit provider title-change coverage so the default-body heading rewrite is exercised alongside the note-sync path
- Wrapper verification status:
  - `pnpm typecheck` currently fails outside this lane in `packages/contracts` script-module resolution/type errors
  - `pnpm test` and `pnpm test:coverage` currently fail outside this lane in `apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`
Completed: 2026-03-28

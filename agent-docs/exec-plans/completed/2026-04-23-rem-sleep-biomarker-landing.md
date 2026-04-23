# REM sleep biomarker landing

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Land the supplied REM sleep biomarker Health Commons patch so the new content resolves through the existing data-driven biomarker page at `/biomarkers/rem-sleep-minutes`, with authored sources, a change record entry, and any required generated catalog updates.

## Success criteria

- The REM sleep biomarker markdown page and supporting REM sleep source pages are present under `packages/health-commons/content/**`.
- The Health Commons generator accepts the new content and emits any required generated artifacts without stale-output mismatches.
- Scoped verification for the touched Health Commons slice passes, or any unrelated blocker is named precisely.
- A scoped commit contains only this task's files plus plan and ledger closeout.

## Scope

- In scope: the supplied REM sleep biomarker content files, the 2026-04 Health Commons change record entry, directly required generated Health Commons artifacts, plan/ledger bookkeeping, and minimal current-HEAD porting if the patch no longer applies cleanly.
- Out of scope: new `apps/web` route work, unrelated Health Commons content refreshes, broader source rewrites, schema changes, and overlapping dirty-tree work elsewhere in the repo.

## Constraints

- Technical constraints: preserve existing Health Commons schema/frontmatter conventions, keep the route data-driven, and avoid widening beyond the touched Health Commons content and directly required generated outputs.
- Product/process constraints: preserve unrelated dirty-tree edits, do not expose direct personal identifiers in repo files or commit metadata, and use the repo plan/ledger plus scoped commit workflow.

## Risks and mitigations

1. Risk: the supplied patch may not apply cleanly against current HEAD because adjacent Health Commons content or generated artifacts drifted.
   Mitigation: dry-run with `git apply --check`, then port only the minimal conflicting hunks by hand if needed.
2. Risk: generated artifacts may pick up unrelated concurrent Health Commons churn.
   Mitigation: inspect the generated diff carefully, stage only the task-owned artifact changes, and stop if overlapping active work makes the output ambiguous.

## Tasks

1. Register the task in the coordination ledger and inspect the supplied patch against current HEAD.
2. Apply or minimally port the REM sleep biomarker content changes.
3. Run Health Commons generation and inspect the resulting diff for scope.
4. Run scoped verification and required completion review for the landed slice.
5. Create a scoped commit with plan and ledger closeout.

## Decisions

- Use a dedicated active plan even though this is a supplied patch landing because the task is multi-file and needs commit/ledger closure in a dirty tree.
- Keep the implementation scoped to `packages/health-commons/**` unless verification exposes a directly coupled requirement elsewhere.
- Update the directly coupled `apps/web` biomarker-route test instead of adding production route code because the new REM biomarker is already publishable through the existing data-driven resolver.

## Verification

- Commands to run:
  - `git apply --check /Users/willhay/Downloads/rem-sleep-biomarker.patch`
  - `git apply /Users/willhay/Downloads/rem-sleep-biomarker.patch` or equivalent minimal manual port
  - `pnpm --dir packages/health-commons generate`
  - `pnpm --dir packages/health-commons verify`
  - `git diff --check`
- Expected outcomes:
  - The patch lands cleanly or is minimally ported with equivalent content.
  - Generated Health Commons artifacts are current.
  - Package-local verification is green, or any unrelated pre-existing blocker is called out precisely.

## Progress

- Completed:
  - Confirmed the supplied patch applied cleanly against current `HEAD`.
  - Landed the REM sleep biomarker content, REM source pages, and the April change-record entry.
  - Regenerated the directly coupled Health Commons artifacts: `catalog.hash`, `catalog.json`, `entities.ndjson`, and `recent-changes.json`.
  - Updated `apps/web/test/health-commons-biomarker-detail-page.test.ts` so the published biomarker route list includes `rem-sleep-minutes`, the REM route resolves through `BiomarkerPage`, and the mock call state resets between route-resolution tests.
  - Passed `pnpm --dir packages/health-commons generate`.
  - Passed `pnpm --dir packages/health-commons verify`.
  - Passed `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/health-commons-biomarker-detail-page.test.ts --no-coverage`.
  - Passed `pnpm --dir apps/web typecheck:prepared`.
  - Passed `git diff --check`.
  - Required `task-finish-review` audit pass completed with no concrete findings.
- Remaining:
  - Create the scoped commit and close the plan.
Completed: 2026-04-23

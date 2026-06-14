# PR 168 ReviewGPT fixes

## Goal

Fix the accepted ReviewGPT findings against PR 168's universal metric
queryability branch.

Success criteria:

- Losing wearable conflict candidates still suppress raw duplicate observation
  points without appearing in public metric provenance.
- Device deletion tombstone observations stay out of metric query and browser
  metric surfaces.
- Importer-shaped daily summary observations project as day-grain metric
  points, including legacy records missing `observationGrain`.
- Focused query/importer tests and scoped verification pass.
- Publish a stacked PR against `murph-query-metric-universality`.

## Constraints

- Preserve unrelated worktree edits and active plans.
- Keep the fix bounded to query metric projection and shared device
  normalization.
- Do not expose secrets, local user identifiers, or home paths in committed
  artifacts.

## Approach

1. Separate summary suppression IDs from public provenance IDs.
2. Filter deletion sentinel observations at generic observation extraction.
3. Thread `observationGrain` through shared device observation normalization
   and add projection compatibility for legacy daily provider summaries.
4. Add focused regressions for the three accepted findings.
5. Run query/importer verification, commit, push, and open a stacked PR.

## State

Active.

## Notes

- Based on PR 168 head `fbbac6aa7`.
Status: completed
Updated: 2026-06-13
Completed: 2026-06-13

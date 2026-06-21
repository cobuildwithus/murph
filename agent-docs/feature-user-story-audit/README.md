# Feature User-Story Audit

This folder holds the canonical hosted-web feature tracker for the broad user-story audit.

## Canonical Tracker

- `feature-status.csv` is the current spreadsheet-compatible source of truth.
- Each row is one feature/user story derived from current code and test evidence.
- The tracker includes inventory columns and testing-loop columns so testing can proceed in the same artifact.
- Current rollup: 215 feature rows; 209 inventoried and 6 dead/unreachable; 191 testing-loop rows passed and 24 are blocked by missing automated story tests.
- `testing-errors.md` summarizes all non-passing story rows and verification-level notes, derived from the tracker.

## Columns

- `feature_id`: stable kebab-case feature identifier.
- `area`: product or technical area.
- `route_or_surface`: page, route, component, service, or internal surface.
- `user_story`: user-story phrasing.
- `expected_behavior`: behavior expected from current code.
- `primary_evidence`: repo-relative code evidence.
- `existing_test_evidence`: repo-relative test evidence, or `none found`.
- `feature_status`: inventory state such as `inventoried` or `dead/unreachable`.
- `test_coverage_status`: existing automated coverage summary: `covered`, `partial`, or `missing`.
- `inventory_notes`: worker notes and dedupe context.
- `testing_loop_status`: current end-to-end/story-test status.
- `last_test_command`: most recent command or manual check used for this story.
- `last_test_result`: latest result summary.
- `observed_errors`: reproducible failures or defects found during story testing.
- `source_worker`: worker lane that produced the row.
- `tracker_updated`: last tracker update date.

## Spreadsheet Export Note

The requested `.xlsx` workbook export is currently blocked because the spreadsheet skill's required `@oai/artifact-tool` package is not resolvable in this runtime. Until that runtime is available, `feature-status.csv` is the single canonical spreadsheet-compatible tracker.

# Feature Audit Gap Triage

## Goal

Explain why the 24 missing-test rows and 6 dead/unreachable rows in the hosted web feature user-story tracker are missing, blocked, or unreachable, using current code and test evidence.

## Scope

- Canonical tracker and reports under `agent-docs/feature-user-story-audit/**`.
- Source inspection under `apps/web/**` only as evidence.
- No production code changes unless source inspection proves a real broken feature that cannot be documented truthfully.
- Preserve unrelated dirty checkout changes.

## Deliverables

- Concrete cause for each missing-test row.
- Concrete reachability explanation for each dead/unreachable row.
- Updated tracker/report with those causes.

## Verification Plan

- Parse the tracker and validate row counts.
- Read referenced code/tests for the affected rows.
- Run direct text/schema checks for updated docs/artifacts.
- Run `pnpm typecheck` unless the task remains Markdown-only and no tracker artifact changes occur.

## State

- Done: extracted 24 missing-test rows, 6 dead/unreachable rows, and their 26 unique affected feature IDs.
- Done: inspected the referenced app routes, components, and tests for each affected row.
- Done: updated the tracker and reports with row-level missing-coverage and reachability causes.
- Done: artifact validation, privacy/ASCII scans, 48 focused app tests, and workspace typecheck passed.
- Now: commit the scoped docs/artifact changes.
- Next: hand off the concrete gap causes and recommended follow-up order.
Status: completed
Updated: 2026-06-21
Completed: 2026-06-21

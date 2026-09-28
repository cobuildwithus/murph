# Recover oversized Junction feature windows

Status: completed
Created: 2026-09-28

## Outcome and scope

Recover full reconcile/backfill hourly-feature collection when a complete day
exceeds the existing record cap. Reuse the current day-to-hour continuation.
Keep hourly overflow, daily-aggregate atomicity, sparse/ECG limits, source
admission, foreground yield and canonical write ownership unchanged.
Resource-only job recovery and increasing collection limits are out of scope.

## Product UX

- Effort: Patch.
- Outcome: Dense connected-device history can progress through smaller complete windows.
- Reaches: Existing full reconcile/backfill jobs; no new member action.
- Proof: Actual client/provider synthetic overflow, zero partial imports, hourly
  continuation and later import; daily and one-hour rejection controls.

## Evidence and decisions

- Existing page-overflow adaptation passes; synthetic daily record overflow
  fails with JUNCTION_API_RECORD_LIMIT on the unchanged base.
- Change only the existing oversized-window predicate, preserving the client
  error contract and record cap.
- Initial external authoring was unavailable. The user explicitly directed
  local implementation and merge/deployment after those tooling failures.
  Parent review and focused checks remain required; external ReviewGPT is waived
  for this task under that direction rather than replaced by another agent.
- No production data recovery or provider actions are part of deployment.

## Completion

- [x] Focused provider/client tests: 54 passed; changelog tests: 10 passed.
  Device-sync and hosted Web typechecks passed.
- [x] Parent candidate review, complexity (debt 315 to 315; max 96 to 96),
  documentation drift/gardening and whitespace checks passed.
- [x] Scoped implementation commit and draft PR #3749.
- Exact-head CI, mergeability and authorized protected deployment are release
  gates tracked in the PR and automation handoff after this implementation plan
  closes; no deployment or production recovery is claimed by this plan.
Updated: 2026-09-28
Completed: 2026-09-28

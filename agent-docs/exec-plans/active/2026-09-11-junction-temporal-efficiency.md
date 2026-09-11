# Reduce repeated Junction complete-day sweeps

Status: active
Created: 2026-09-11
Updated: 2026-09-11

## Outcome and protected invariant

Reduce complete-day oxygen/stress collections while preserving ordinary device
sync, late-data repair, complete-day authority, source revocation, and durable
recovery. Existing hourly reconciliation currently repeats the full temporal
horizon even when no data changed.

## Design

- Remove the special inline newest-day fetch. Use the existing resource/day queue
  for the entire bounded horizon, newest first and below ordinary work priority.
- Record a provider-owned, versioned daily sweep scheduling marker in existing
  connection metadata, atomically with the child jobs in the current completion
  transaction. It records scheduling only, never health completeness. Missing,
  or mismatched hashes schedule safely. The scope includes newest eligible day,
  timezone, resources, horizon, and stable provider roster/capabilities.
- Webhook resource execution schedules separate complete-day reads intersecting
  its event window within
  the existing rolling feature horizon, plus days awaiting the existing 24-hour
  completeness lag. Use the existing stable day keys and account execution fence
  so bursts coalesce and an event received during a fetch runs afterward.
- Keep per-job retries and the daily repair sweep. Keep complete-source-day
  validation, empty retractions, partial-page failure, and live source checks.
- Include the previous no-op telemetry commit. Existing checkpoint suppression
  in PR #3282 needs rollout, not a duplicate implementation.

## State and compatibility

The existing account metadata and job queue remain the only scheduling owners.
No new service, timer, table, raw payload, or authority cache. Old runtimes ignore
this optional metadata and keep their more frequent sweep; queued day payloads
remain compatible. The marker and queue must commit together or neither may
advance. New data outside the existing feature horizon retains ordinary ingestion;
this change does not expand indefinite historical feature repair.

## Product UX

- Outcome: quieter background work with event-driven updates and bounded daily repair.
- Reaches: established and newly connected sources, delayed Garmin data, duplicate
  events, cold restores, timezone changes, empty/corrected data, and disconnects.
- Proof: real service/store scheduling across restart and in-flight event arrival;
  provider request windows and canonical importer regression coverage.

## Tasks

1. Add failing request-count and targeted-refresh regressions.
2. Collapse temporal scheduling into queued daily sweeps and targeted day jobs.
3. Update owner docs and relevant focused verification.
4. Parent review, scoped commit, PR and routed external review/CI.
5. Use the supported rollout path, then measure production traffic and no-op counts.

## Verification

Local implementation and parent candidate review are complete. Product UX: Ready
for candidate review; production behavior still requires rollout verification.

- Device-syncd history/source reuse/admission/store/hosted hints: 186 passing tests.
- Device-syncd resource tests: 51 passing; webhook tests: 46 passing.
- Device-syncd service: 151 passing, including durable sweep metadata, restart,
  source widening, concurrent webhook arrival, and pending-day coalescing.
- Canonical Junction bounded-feature importer: 37 passing tests.
- Hosted maintenance/log parser: 112 passing tests, including whole-pass no-op
  counters beyond the slow-job sample limit.
- Both device-syncd and assistant-runtime typechecks passed.
- Complexity guard passed: Junction above-threshold debt decreased from 405 to
  396; maximum remains 143. Existing resource dispatch is unchanged in complexity;
  temporal event targeting has one small provider-owned helper.
- Log payload guard, docs drift, and diff whitespace checks passed.
- Updated obsolete inline-fetch fixtures to execute queued children explicitly.
  The race fixture uses the same clock for webhook ingress and worker execution.
- Parent checked import authority, failed/yielded work, atomic metadata/queue
  completion, late events, finite fanout, optional metadata compatibility, and
  privacy. No new tables, timers, authorization cache, or callback requests.
- Changelog not applicable: internal background request reduction and telemetry;
  no new member capability or claimed foreground performance improvement.

Pending: exact-head external review and required CI, followed by the supported
hosted rollout and a bounded production traffic/no-op comparison.

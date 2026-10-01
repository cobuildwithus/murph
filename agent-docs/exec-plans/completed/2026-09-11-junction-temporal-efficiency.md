# Reduce repeated Junction complete-day sweeps

Status: completed
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
remain compatible. The local marker and queue must commit together or neither may advance. Hosted
publication additionally requires the existing workspace checkpoint: retained wake
hints restore the exact queue and marker together without restoring SQLite. New data outside the existing feature horizon retains ordinary ingestion;
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

Round 1 final review found a reachable hosted recovery gap: local SQLite commits
were atomic, but Web could publish suppression before the retained work checkpoint.
The finding is accepted. The user authorized remediation after the required review
pause. The correction carries the marker through existing checkpointed wake hints
and fences Web publication; it adds no queue, timer, or authority cache.

Remediation and parent candidate review are complete. Product UX: Ready for final
review. Production behavior still requires rollout verification.

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

Remediation verification:

- Real hosted pass crashes after control-plane apply and before the returned
  retained-wake checkpoint. Web keeps the prior marker; replay from a fresh
  runtime reconstructs all seven stress days, including the oldest. A saved wake
  restores exact jobs and the marker, then permits publication. A same-day cold
  root schedules no repeated temporal children.
- Completion publication preserves unrelated metadata and respects reconnect
  epochs even when cadence has not changed. Hint parsing bounds the optional
  hash and metadata hydration preserves local queued scheduling only within an epoch.
- All 131 hosted runtime tests, 112 hosted maintenance tests, and 109 hosted hint
  tests pass. Three old inline-sweep fixtures now execute queued day authority;
  ordinary-fact durability through slow/yielded resources remains asserted.
- Both affected package typechecks pass. Complexity guard passes: hosted runtime
  debt remains 143 and maximum remains 75; Junction debt remains reduced by nine.
  Log guard, documentation drift, and diff whitespace checks pass.
- Parent confirmed source admission remains live, the recovery record owns exact
  jobs before remote suppression, no additional HTTP call or persistence owner is
  introduced, and old readers can drop the optional hint without losing jobs.

Round 2 found the same recovery gap through warm hydration: preserving the local
marker without setting `preservedLocalProgress` let an accepted baseline contain
unpublished state. The finding is accepted. The real hosted-pass fixture now
reproduces the failure after a successful Web apply loses its response, retries
in the same workspace, handles a resource-unavailable metadata change, loses a
second apply response, and then restores the original checkpoint without SQLite.
The existing unpublished-progress flag now includes local/remote sweep-hash
mismatches. The regression failed on the reviewed candidate and passes after this
four-line correction. All 240 affected hosted-runtime/hint tests and both package
typechecks pass; completed checkpoint, cadence, reconnect, and coalescing proof
remain intact. No additional state owner or API request was added.

## Final implementation outcome

Round 3 ReviewGPT passed on `81781fa7c706f3ebf54bf41cf12c16c6be064371`.
The captured response and companion verify `gpt-6-pro`; response SHA-256 is
`fa208e8d74069e69760bd641b7054ab375a73b5e0bac40103bedb5e5f4cf3fe8`.
Both accepted recovery findings are resolved. The reviewer verified all 104 diff
hunks and 25 changed-file hashes, inspected the real hosted crash test, and ran
17 scheduling probes; it did not rerun the package suites or typechecks.

Parent final review confirms checkpoint-backed publication, warm hydration's
actual Web baseline, same-epoch restoration, live source admission, bounded
scheduling, and whole-pass outcome accounting. Product UX: Ready. Four remaining
stale inline-fetch CI fixtures were updated; all 189 tests across those backfill
and diagnostic files pass. No runtime edits followed the reviewed candidate.

The implementation plan is closed. The original owning session continues PR
#3311 through required CI on the final documentation commit, normal merge, the
protected hosted rollout, and bounded production verification. Deployment and
measured request reduction are not claimed by this implementation record.
Completed: 2026-09-11

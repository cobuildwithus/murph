# WHOOP Overnight HRV

## Outcome

Replace the foreground 60-second WHOOP BLE spot reading with an explicit
user-started overnight capture that computes one science-backed,
PPG-derived RMSSD summary on iPhone and imports one canonical fact per sleep
night. Raw BLE frames and pulse intervals must never leave the phone.

## Scope

- Define and document the versioned overnight windowing, artifact rejection,
  minimum-coverage, aggregation, timezone, and identity contract.
- Update the companion observation boundary and canonical device-sync
  importer so one completed sleep night produces one retained RMSSD event.
- Update the sibling iOS companion PR to run the WHOOP BLE stream during an
  explicit overnight session, keep raw intervals local, upload only the
  completed derived summary, and clearly distinguish it from WHOOP Recovery.
- Keep one data owner and one retry path; do not add a second queue, scheduler,
  database, or generic background-monitoring subsystem.

## Invariants

- The result is Murph's PPG-derived overnight RMSSD, not WHOOP's proprietary
  sleep-stage-weighted Recovery HRV and not Apple Health SDNN.
- Raw BLE packets, pulse intervals, frame timestamps, and device identifiers
  are neither uploaded nor logged.
- A structurally valid completed session is idempotent and maps to one
  vault-local sleep night; retries and timezone changes cannot create extra
  daily rows.
- Short or low-coverage captures fail closed instead of masquerading as an
  overnight measurement.
- Disconnect and consent boundaries retain their current single ownership.

## Protocol

- A user starts the session before sleep and finishes it after waking. The
  iPhone keeps only the current five-minute window plus aggregate state in
  memory; process loss fails closed.
- Session-anchored, non-overlapping five-minute windows accept only
  375–2,000 ms intervals. At window close, an offline, non-recursive centered
  mask uses five intervals from one uninterrupted segment, rejects the
  first/last two, and applies the versioned 200 ms local-median operational
  rule. RMSSD never bridges a rejected interval, transport discontinuity, or
  window boundary.
- Each accepted window contains 240–300 seconds of pair-supported interval
  coverage: only the later interval in an accepted adjacent pair from the
  delivered validated stream contributes to both coverage and RMSSD. A night
  requires 48–192 completed windows, at least 48 accepted windows, and at least
  half of completed windows accepted. Its result is the equal-weight mean of
  accepted-window RMSSDs.
- The authenticated payload contains only `schema`, `methodVersion`,
  `nightDate`, `rmssdMs`, `completedWindowCount`, and
  `acceptedWindowCount`. It contains no exact time, duration, timezone,
  coverage milliseconds, per-window value, interval, packet, or device
  identity.
- Existing receipt storage owns one exact envelope per connection and
  `nightDate`; a different envelope for that night fails before staging. The
  canonical event uses the phone-owned date and a deterministic daily-summary
  time, so vault timezone changes cannot change its identity or placement.
- All health/window state remains memory-only. The only persisted iOS state is
  one non-health cleanup-intent bit set before enabling the band-global live
  stream and cleared after confirmed disable, allowing a restored launch to
  clean up without pretending the lost calculation survived. A reconnect may
  continue under the same session owner only after a hard discontinuity.

## Work

1. Confirm the published HRV protocol evidence and iOS Core Bluetooth
   background constraints.
2. Replace the backend spot schema, normalization, replay identity, retention,
   and documentation with the overnight contract and tests.
3. Replace the iOS spot transport/analyzer/UI with an explicit overnight
   session and matching contract tests.
4. Run scoped and full owner verification, coverage, security/privacy, and
   deep-review audits in both repositories.
5. Commit and push both PR heads, start ReviewGPT alongside CI, and resolve all
   accepted findings.
6. Preserve a signed-iPhone overnight capture-to-query proof, including a
   secret-safe network/log inspection that confirms raw data is absent, as a
   distribution gate that cannot be satisfied by simulator or local CI.

## Distribution gates

- Do not distribute the iOS build until a signed physical iPhone completes an
  overnight capture-to-query test and secret-safe network/log inspection.
- Do not make accuracy claims until the versioned estimator passes the planned
  paired-ECG validation, and do not distribute without the required written
  WHOOP authorization and privacy/legal approval.

## Verification

- Backend contract, importer, core, route, and device-sync owner tests plus
  relevant TypeScript checks and coverage.
- iOS XcodeGen generation, SwiftFormat lint, unit tests, and Release build.
- Completion audit for contract parity, one-night cardinality, privacy,
  background interruption, reconnect, retry, and timezone replay behavior.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14

# WHOOP Automatic Overnight HRV

## Outcome

Replace the manual nightly Start/Finish contract with one explicit WHOOP
enrollment followed by automatic fixed-window overnight PRV-RMSSD capture in
the iOS companion. Keep the backend at exactly one compact canonical fact per
connection and `nightDate`.

## Scope

- Version the method as a scheduled local `00:00–08:00` protocol rather than
  a user-bounded session.
- Keep the existing strict six-field authenticated payload, encrypted staging,
  canonical import, retry ownership, acknowledgement, and one-night identity.
- Align backend durable documentation and tests with passive iOS capture.
- Preserve explicit disconnect authority; ordinary passive recovery must not
  silently create or reactivate a disconnected provider lane.
- Do not add a scheduler, table, queue, per-window row, migration, or generic
  wearable background service.

## Invariants

- The value remains a WHOOP BLE pulse-rate-variability estimate, distinct from
  WHOOP Recovery, provider daily HRV, Apple Health SDNN, and ECG HRV.
- The backend accepts only `schema`, `methodVersion`, `nightDate`, `rmssdMs`,
  `completedWindowCount`, and `acceptedWindowCount`.
- Raw BLE packets, pulse intervals, packet/capture timestamps, device identity,
  per-window values, and timezone details never cross the iOS upload boundary.
- One connection and `nightDate` produce at most one immutable canonical fact;
  retries do not create additional rows.
- The iOS app owns capture timing and compact retry state. The backend owns no
  nightly trigger or capture lifecycle.

## Work

1. Rebase both PR branches onto current `main` without discarding existing work.
2. Change the exact method literal and backend documentation/tests to the
   scheduled protocol.
3. Confirm or minimally tighten sign-in-session reconnect authority without new
   persisted state.
4. Verify the touched contracts, web admission, importer, and canonical write
   paths.
5. Commit, push, run CI and ReviewGPT concurrently, and resolve every accepted
   finding before handoff.

## Verification

- Truthful diff-aware backend verification for contracts, web, importer, core,
  and affected reverse dependents.
- Focused route/import/replay/disconnect tests.
- Required coverage-write audit and the PR-lane ReviewGPT gate.
- Physical signed-iPhone continuous-stream, notification, and capture-to-query
  proof remains an iOS distribution gate, not a backend CI claim.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14

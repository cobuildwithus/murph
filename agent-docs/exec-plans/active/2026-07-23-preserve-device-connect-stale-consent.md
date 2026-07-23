# Preserve device connection through stale launch consent

Status: active
Created: 2026-07-23
Updated: 2026-07-23

## Goal

- Keep configured device connection and reconnection flows available when an
  existing member's launch-document acceptance becomes stale.
- Keep Strava disabled across web and assistant connection surfaces.

## Success criteria

- A stale launch grant does not block dashboard access to device connection,
  hosted connect starts, or current companion device sync.
- Every configured non-Strava provider remains available; Strava is neither
  offered nor accepted as a connect target.
- Existing data, sync, containers, and current-conversation texting remain
  unchanged.
- Focused tests, canonical acceptance, merge-conflict reconciliation, CI, and
  final exact-head review pass.

## Scope

- In scope: dashboard stale-consent presentation, device connect/reconnect
  authority, companion device sync authority, provider target configuration,
  assistant provider offers, and focused tests/docs.
- Out of scope: consent requirements for billing, group membership, clinical
  records, vault export, and unrelated sensitive actions.

## Constraints

- Technical constraints: preserve active member/session, CSRF, source-specific
  OAuth, capacity, and provider authorization checks; no new persisted state.
- Product/process constraints: stale consent may remain visible and recoverable
  but must not be a device-connect stop; Strava stays disabled by explicit user
  direction.

## Risks and mitigations

1. Risk: relaxing the wrong authority boundary exposes non-device actions.
   Mitigation: delete launch-consent assertions only from exact device
   connection/current-sync paths and retain every other guard.
2. Risk: current `main` changed dashboard/design ownership concurrently.
   Mitigation: merge current `main`, preserve both behaviors, and rerun the
   directly affected tests plus canonical acceptance.

## Tasks

1. Trace all connection/reconnection and current device-sync entrypoints.
2. Remove stale-launch blocking from those exact paths and make the dashboard
   reminder non-blocking.
3. Disable Strava consistently across configured targets and assistant offers.
4. Reconcile current `main`, update behavior/docs/tests, and verify.
5. Commit, push, and complete final exact-head review plus CI.

## Decisions

- Member authorization to the provider remains mandatory; only Murph's stale
  launch-document version gate is removed from device connection/current sync.

## Verification

- Commands to run: focused Vitest suites and typechecks, `pnpm test:diff`,
  `pnpm verify:acceptance`, mergeability/CI checks, and final ReviewGPT rounds.
- Expected outcomes: all task-owned checks pass; any unrelated baseline failure
  is recorded with direct evidence.

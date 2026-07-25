# Preserve device connection through stale launch consent

Status: completed
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

## Evidence

- Hosted Web typecheck passed.
- Focused Hosted Web verification passed across 15 files and 250 tests; the
  consent-reminder resilience subset passed across 6 files and 133 tests.
- Device Syncd connect-target coverage passed with 7 tests, and Assistant
  Runtime provider-offer/workspace coverage passed with 248 tests.
- Legal PDF generation was deterministic across two consecutive runs, and the
  generated manifest and versioned/current PDFs match the authored policies.
- Canonical `test:diff` Testbox `tbx_01ky74jbxa1a6n7vv3hgeerwds` passed all
  task-owned checks and stopped on two unrelated baseline failures: the hosted
  local harness parent-signal timeout and a missing generated Health Commons
  fixture path in Vault Usecases.
- Canonical `verify:acceptance` Testbox
  `tbx_01ky74jk7bjt1teqzvbg7yvfw9` passed, including the production Web build
  and Cloudflare hosted-runtime verification.
- The reconciled preliminary specialist pass first returned evidence-only
  `INVALID`; complete public desktop/mobile evidence then produced three
  actionable findings. The implementation now retains successful intermediate
  consent scopes across retries, keeps Function Health unconditionally on the
  export/share-and-upload path, and uses a flat full-width mobile consent-card
  composition.
- Post-remediation consent coverage passed 9 tests across the dashboard and
  card suites, Assistant Engine prompt coverage passed 29 tests, and the Hosted
  Web typecheck passed.
- Refreshed public design evidence covers unchecked, checked, saving, accepted
  handoff, and retryable-error consent states at desktop and mobile widths. The
  composition evidence includes production device-source cards below the
  reminder so available Connect actions are directly visible.
- Post-remediation `pnpm test:diff` Testbox
  `tbx_01ky79cvd0hjj1t15tjete5ma5` passed all changed-owner tests and
  typechecks, then stopped on the same two unrelated baseline failures: the
  hosted-local-harness parent-signal timeout and a missing generated Health
  Commons fixture path in Vault Usecases.
- The first post-remediation `pnpm verify:acceptance` Testbox
  `tbx_01ky79cvcxxnd47t2em3gc2sap` passed the production Web build and
  Cloudflare runtime suite, then hit one unrelated full-load preference-handoff
  sweeper timeout. The exact sweeper file passed all 9 tests immediately in
  isolation. Full acceptance retry Testbox
  `tbx_01ky79qe58k6r3pc2jn2gywc10` then passed end to end, including the
  production Web build, all workspace checks, 1,872 Cloudflare node-platform
  tests, and the Workers suite.
Completed: 2026-07-23

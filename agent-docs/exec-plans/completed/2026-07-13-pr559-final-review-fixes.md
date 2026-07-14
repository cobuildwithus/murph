# PR 559 final review fixes

## Goal

Resolve the two validated final ReviewGPT findings without changing the
companion privacy boundary: terminal hosted snapshots must update the same
local device account after web scrubs provider identity, and Apple Health HRV
must remain SDNN instead of entering the RMSSD metric series.

## Success criteria

- The local device-sync store binds a hosted connection's opaque id to one
  account across active, reauthorization-required, and disconnected snapshots.
- A terminal identity scrub updates that account in place, terminalizes its
  provider-dependent work, and preserves only already-accepted credential-free
  companion RMSSD work.
- Apple HealthKit-origin HRV normalizes and queries as `hrv-sdnn`; WHOOP
  companion capture normalizes and queries as `hrv-rmssd`; same-day values do
  not select or aggregate together.
- No raw packets, R-R intervals, Apple comparison values, device identity, or
  credentials enter companion upload payloads, mailbox hints, or logs.
- Focused tests, typechecks, truthful diff verification, required local audits,
  final-head ReviewGPT, PR CI, and GitHub merge-readiness gates pass.

## Working set

- `packages/device-syncd/src/store/{schema,accounts,hosted-account-hydration}.ts`
- `packages/device-syncd/src/store.ts`
- `packages/device-syncd/test/store.test.ts`
- `packages/assistant-runtime/src/hosted-device-sync-runtime.ts`
- `packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts`
- `packages/importers/src/device-providers/junction.ts`
- `packages/importers/test/device-providers-junction.test.ts`
- `packages/health-metrics/src/definitions/recovery.ts`
- `packages/health-metrics/test/index.test.ts`
- `packages/query/src/metrics/index.ts`
- `packages/query/src/wearables/candidates.ts`
- `packages/query/test/query.test.ts`
- Matching architecture, security, companion, provider-compatibility, and
  testing docs only where the corrected contract must remain durable.

## Persisted-state classification

The hosted connection binding is durable local operational state in the
existing `.runtime/operations/device-sync/**` SQLite owner. It is an opaque
control-plane identifier, not canonical health truth or provider identity.
The existing `PRAGMA user_version` migration seam owns the additive column and
unique index.

## Verification plan

- Store migration and hydration tests for first binding, in-place scrub, and
  fail-closed identity conflict.
- Hosted runtime regression proving an active row cannot survive a terminal
  scrub under a second local identity, while accepted companion work drains.
- Importer tests covering Apple Health sleep/timeseries SDNN and explicit WHOOP
  companion RMSSD.
- Query test with same-day Apple SDNN and WHOOP RMSSD proving separate keys,
  selections, and aliases, plus historical generic Apple HRV reprojection.
- Focused owner tests and typechecks, then truthful `pnpm test:diff` coverage.
- Required coverage-write and security/privacy completion audits, parent final
  review, scoped plan-closing commit, push, final-head ReviewGPT, PR CI, and
  final GitHub head/review/mergeability verification.

## External proof limitation

The real 60-second capture-to-query proof still requires the owned physical
iPhone/WHOOP test surface and authenticated session. It must not be simulated.

## Completion evidence

- Device-syncd: 792/792 tests; assistant-runtime: 1,543 passed, 2 skipped;
  importers: 354/354; health-metrics: 57/57; query: 492/492.
- All five owner-package typechecks passed.
- `pnpm test:scenario-integrity` passed for 205 scenarios, 11 sample inputs,
  and 28 golden-output directories.
- `pnpm test:diff` passed the affected 18-package typecheck/test lane, hosted
  package boundary, web verification (4,343 passed, 135 skipped; production
  build, dev smoke, and lint with 11 existing warnings), and Cloudflare
  verification (1,736/1,736).
- Coverage-write and security/privacy completion audits are clean after the
  historical Apple HRV reprojection regression was added and fixed.
- Parent final review found no remaining evidence-backed defect in the scoped
  correction diff.

## State

Active.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13

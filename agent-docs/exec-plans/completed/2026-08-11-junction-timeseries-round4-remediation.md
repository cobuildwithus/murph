# Junction timeseries round-four remediation

Status: completed
Created: 2026-08-11
Updated: 2026-08-12

## Goal

Resolve ReviewGPT's remaining temporal-ownership findings without adding a
cursor, watermark, background repair, or second aggregate owner.

## Success criteria

- Precise caffeine, water, and mindfulness snapshots publish exact interval
  records but never publish a partial daily sum.
- The calendar-day path remains the sole writer of sparse daily sums after the
  provider date is complete.
- Glucose, blood oxygen, stress, caffeine, water, and mindfulness daily facts
  wait until the provider date has closed in every admitted civil offset.
- An early reconcile cannot prevent a later same-UTC-day closed-date import.
- Focused tests cover precise set growth, immutable same-ID conflicts,
  negative-offset closure, both transport orders, and versioned/unversioned
  records.

## Scope

- In scope: Junction snapshot window metadata, sparse/daily normalization
  ownership, provider-date closure, focused transport/import/query tests, and
  owning architecture documentation.
- Out of scope: raw stream retention, new resources, new runtime state,
  migrations, UI work, and unrelated device providers.

## Constraints

- Preserve the existing daily compatibility facts and exact sparse events.
- Keep ordinary per-record Junction resources on their existing freshness
  path; the conservative closure rule applies only to the six resources whose
  daily aggregate or feature shape requires a complete provider date.
- Retain existing bounds, idempotency, and revision-conflict behavior.

## Tasks

1. Mark precise versus calendar-day snapshot ownership explicitly.
2. Suppress sparse daily sums in precise snapshots while retaining intervals.
3. Gate the six calendar-owned resources on global provider-day closure.
4. Add transport, importer, core/query, and immutable-conflict regression
   proof.
5. Update owner docs, verify, commit, push, and rerun ReviewGPT with CI.

## Verification

- Importer suite: 402 tests pass, including precise interval-only ownership.
- Device-syncd focused transport/service suite: 397 tests pass across the
  provider, resource aliases, blood-pressure compatibility, and worker seam.
- Query normalized wearable surface suite: 18 tests pass.
- Importer, device-syncd, and query typechecks and builds pass.
- Scenario integrity, docs drift, diff check, and privacy inspection pass.
- Exact-head CI and the next ReviewGPT round remain for the pushed PR head.
Completed: 2026-08-12

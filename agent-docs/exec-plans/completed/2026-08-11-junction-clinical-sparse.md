# Persist sparse Junction clinical and safety readings

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Persist Junction's sparse clinical and safety readings as canonical vault
  events with compact per-record evidence, without retaining provider
  timeseries arrays.

## Success criteria

- Heart-rate alerts, sleep-apnea alerts, falls, FEV1, FVC, peak flow, and
  inhaler usage normalize to timed canonical facts.
- Exact units, alert type, source provenance, and replay-stable identity are
  retained without raw provider identifiers.
- Valid and invalid payloads always produce compact evidence, so the importer
  never falls back to a full provider snapshot artifact.
- The real core import path accepts and persists a representative batch.
- Focused importer and device-sync provider tests and package typechecks pass.

## Scope

- In scope: Junction resource registration, sparse per-reading normalization,
  compact evidence, webhook/poll fetch proof, core round-trip proof, and
  current provider documentation.
- Out of scope: insulin and carbohydrate events, historical backfill policy,
  dense telemetry, new event kinds, UI, or database schema changes.

## Constraints

- Technical constraints: canonical writes stay in core; no `samples`, raw
  arrays, provider-snapshot fallback, raw identifiers, or free text; keep
  foundation-sensitive resource-list edits minimal.
- Product/process constraints: synthetic fixtures only, preserve source
  admission behavior, use the PR worktree lane, and defer ReviewGPT to the
  coordinator.

## Risks and mitigations

1. Risk: Adding a resource without compact evidence can trigger raw snapshot
   fallback.
   Mitigation: Emit one bounded artifact per accepted record and one tiny
   sentinel for an all-invalid resource payload; assert fallback absence.
2. Risk: Interval resources can collapse distinct same-time readings.
   Mitigation: derive opaque identities from provider row id when present and
   otherwise from source, time, normalized value, unit, and bounded type.
3. Risk: This branch conflicts with shared catalog/history work.
   Mitigation: isolate temporary registration to the two existing catalog
   arrays and do not change history state or scheduling.

## Tasks

1. Add the seven resources to the existing Junction policy lists.
2. Implement one descriptor-driven sparse reading normalizer with strict unit
   and value validation and compact evidence.
3. Add importer/core replay and device-sync fetch tests.
4. Update provider documentation and inspect the diff for privacy leaks.
5. Run focused tests and both package typechecks.

## Decisions

- Reuse `measurement` events instead of introducing a clinical alert event
  type. Measurement entries preserve a numeric fact plus bounded qualifiers;
  the compact evidence preserves the original half-open interval.
- Represent inhaler usage as a measured count, not `medication_intake`, because
  Junction supplies no medication identity and Murph must not invent one.

## Verification

- Commands to run:
  - `pnpm --dir packages/importers exec vitest run --config vitest.config.ts test/device-providers-junction.test.ts`
  - `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts test/junction-provider.test.ts test/config.test.ts`
  - `pnpm --dir packages/importers typecheck`
  - `pnpm --dir packages/device-syncd typecheck`
- Expected outcomes: all focused behavior and type checks pass; generated
  batches contain no samples or provider-snapshot evidence.

## Local results

- Importer Junction tests: 148 passed.
- Contracts resource-policy tests: 6 passed.
- Device-sync Junction/config/catalog tests: 263 passed.
- Contracts, importers, and device-syncd package typechecks: passed.
- `git diff --check`: passed.
Completed: 2026-08-11

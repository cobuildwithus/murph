# Expand wearable summary normalization coverage

Status: completed
Created: 2026-05-29
Updated: 2026-05-29

## Goal

- Expand wearable summary normalization so Junction-exposed workout,
  activity, body, and sleep summary fields become first-class normalized facts
  instead of remaining raw-artifact-only details.

## Success criteria

- Workout normalization captures heart-rate zones, moving time, elevation,
  speed, power, route/map metadata, provider workout id, and sport/activity
  identity when present.
- Activity, body, and sleep summary normalization captures comparable
  provider-exposed summary fields that are currently raw-only.
- Focused tests cover the newly normalized fields without broad refactors or
  speculative provider-specific abstractions.
- Required package verification and completion audits pass, or unrelated
  blockers are documented with evidence.

## Scope

- In scope: existing wearable/device summary normalization code, its canonical
  write/read contracts, and focused importer/query/core tests as needed.
- Out of scope: new provider runtime behavior, raw artifact retention policy,
  schema/storage redesign, UI changes, or support for dense timeseries outside
  compact summaries.

## Constraints

- Technical constraints: preserve current package ownership and canonical write
  boundaries; prefer simple typed field mapping over a new abstraction; do not
  widen default query visibility for dense raw telemetry.
- Product/process constraints: health data remains high-sensitivity; avoid
  writing private sample payloads, direct identifiers, or local paths into
  fixtures, logs, docs, or examples.

## Risks and mitigations

1. Risk: Normalized summaries become a catch-all raw payload mirror.
   Mitigation: Map compact, useful summary fields explicitly and keep raw
   artifacts as the source for provider-specific unsupported detail.
2. Risk: Field naming drifts between workout/activity/body/sleep surfaces.
   Mitigation: Reuse existing metric/event field conventions and add focused
   tests that pin names and units.

## Tasks

1. Locate current summary normalization, canonical write, and read model tests.
2. Identify Junction sample fields currently left raw-only.
3. Extend the existing normalization path with explicit compact summary fields.
4. Add focused tests for workout plus activity/body/sleep additions.
5. Run typecheck, scoped coverage, required audits, and commit through
   `scripts/finish-task`.

## Decisions

- Keep the implementation in existing normalization seams unless inspection
  proves a small helper would reduce real duplication.
- Do not add raw-only `meal` summary retention in this slice. Leave meal,
  menstrual cycle, ECG, workout stream, and new workout timeseries resources
  unsupported unless a separate product/privacy decision owns them.
- Keep route/map normalization to compact identifiers/names only. Do not
  normalize route polylines or exact coordinates into typed workout events.
- Normalize compact activity summary facts exposed by Junction, including
  elevation, recording coverage, and strain, as day-level observations.

## Verification

- Commands to run: `pnpm typecheck`; `pnpm test:diff <touched paths>` or the
  relevant package coverage commands; `pnpm test:smoke` if touched package class
  requires it.
- Expected outcomes: all required checks pass, with direct evidence from focused
  normalization tests for the added fields.

## Progress

- Implemented typed workout detail expansion and Junction summary metric
  mappings.
- Added importer/query boundary tests, including contract-bound long sport and
  HR-zone cases.
- Security/privacy audit flagged route geometry exposure; normalized route
  geometry was removed.
- Security/privacy audit flagged unsupported-resource raw snapshot fallback and
  source identifier key variants; both are filtered in the raw artifact path.
- Final review flagged raw-only meal retention and route geometry exposure;
  both were removed from the scoped change.
Completed: 2026-05-29

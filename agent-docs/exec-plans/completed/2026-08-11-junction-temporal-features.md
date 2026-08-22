# Preserve bounded Junction temporal features

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Preserve bounded, queryable temporal features from Junction blood-oxygen
  and stress streams so materially different daily patterns no
  longer collapse to the same mean/minimum/maximum facts.
- Keep full provider sample arrays out of the vault. Reuse the existing
  importer-to-core canonical write path and the existing one-artifact-per-day
  storage owner.

## Success criteria

- Existing daily SpO2 and stress observations remain unchanged.
- Each resource/source/local-day may add only a versioned compact feature
  envelope and a fixed, tested set of stable summary observations.
- Feature computation is bounded by explicit per-day and per-import input caps;
  overflow suppresses feature output without suppressing existing daily facts.
- No sample records, hourly records, raw timestamp arrays, provider snapshots,
  new provider calls, database work, queue, service, or state owner are added.
- Tests prove sustained-versus-isolated SpO2 burden, stress runs/dayparts,
  local-day grouping, replay stability, caps,
  artifact/event/byte ceilings, and core/query round-trip visibility.
- Canonical architecture and provider-compatibility documentation describe the
  bounded feature policy without overstating clinical meaning.

## Scope

- In scope:
  - Junction importer reduction for `blood_oxygen` and `stress_level`.
  - Compact evidence and daily summary observations through existing canonical
    seams.
  - Focused importer/core/query tests and matching durable documentation.
- Out of scope:
  - Raw or downsampled timeseries retention, hourly rows, live-data validation,
    UI changes, alerts/diagnosis, provider fetch/window changes, sparse-resource
    history, and non-Junction providers.
  - HRV/respiratory sleep-context work and sparse caffeine or heart-rate-
    recovery per-record timing.

## Constraints

- Technical constraints:
  - Preserve stable day/source external references and the existing aggregate
    artifact role; use additive schema evolution only.
  - Cap feature inputs at 5,000 per resource/source/day and 25,000 per
    resource/import. Feature output is all-or-none for an overflowing import.
  - Add no more than ten feature observations per local day across the two
    admitted resources and keep each aggregate artifact under 2 KiB.
  - Keep threshold names explicit and mechanical. Do not label stress features
    as clinical interpretation.
- Product/process constraints:
  - Preserve existing user-critical device sync even when feature extraction
    cannot run.
  - Keep health data and source identifiers out of logs, plans, and durable
    process artifacts.

## Risks and mitigations

1. Risk: Bounded feature extraction could accidentally become another full
   timeseries persistence lane.
   Mitigation: Keep samples in memory only, assert forbidden payload keys and
   sample rows, cap input and output cardinality, and reuse one daily artifact.
2. Risk: Reconcile payload order or gaps could change episode results.
   Mitigation: Sort bounded feature inputs by timestamp and use explicit gap
   semantics with order/replay tests.
3. Risk: Threshold-derived facts could be mistaken for diagnosis.
   Mitigation: Use threshold-specific metric names, retain measurement caveats
   in docs, and avoid diagnostic classifications.
4. Risk: New derived facts could multiply canonical writes.
   Mitigation: Use stable daily external references, a ten-observation ceiling,
   and deterministic maximum-cardinality tests.

## Tasks

1. Add the bounded importer-owned feature reducer and integrate it with the
   existing Junction daily aggregation seam.
2. Persist compact versioned envelope fields and stable daily feature
   observations without changing base observations or artifact count.
3. Add focused shape, cap, replay, privacy, core, and query proof.
4. Update canonical architecture and compatibility documentation.
5. Run focused tests, affected typechecks, diff/privacy inspection, and hand the
   uncommitted branch back for parent review and ReviewGPT orchestration.

## Decisions

- Treat the feature envelope as importer-owned derived health evidence, not a
  new provider transport or canonical state owner.
- Suppress the whole feature set for a resource/import once either input cap is
  crossed so the vault never presents partial feature coverage as complete.
- Keep the existing daily observations even when feature extraction is
  suppressed; temporal enhancement must not degrade device sync.
- Leave glucose-derived shape ownership to the separate metabolic-context
  implementation so the two lanes cannot emit competing facts.
- Compose on the resource-policy/history foundation without changing its
  admission or history values; blood oxygen and stress remain ordinary
  policy-admitted daily aggregates with importer-owned temporal enhancement.

## Progress

- Added and verified bounded SpO2 sample-burden/run features and mechanical
  stress run/variation/local-daypart features through the existing daily
  aggregate and canonical observation seams.
- Kept glucose out of this lane, retained no provider samples or timestamp
  arrays, and preserved base facts plus artifact cardinality on every
  suppression path.
- Merged `codex/junction-resource-policy-history` with its policy/history code
  and tests unchanged. Resolved the shared compatibility documentation to
  describe both policy-derived admission and the bounded feature envelope.
- Verified deterministic input/output caps, replay, core persistence, query
  projection, local/floating time handling, and policy/history composition.

## Verification

- Commands to run:
  - Focused Vitest for Junction importer and the core/query round-trip files.
  - `pnpm --dir packages/importers typecheck`
  - Affected query/health-metrics typecheck only if those packages change.
  - `git diff --check` plus scoped privacy/identifier scans.
- Completed focused proof:
  - Contracts Junction resource tests: 5 passed; contracts typecheck passed.
  - Device-sync Junction provider/catalog tests: 221 passed; device-syncd
    typecheck passed.
  - Junction importer tests: 149 passed; importer typecheck passed.
  - Query scalar-observation projection test: 1 passed; query typecheck passed.
  - Documentation drift/gardening, diff checks, and privacy scans passed before
    integration; the final merge retained those source guarantees.
- Expected outcomes:
  - Shape-sensitive features differ while base daily facts remain identical.
  - Overflow emits no feature observations or feature payload, but base facts
    still import successfully.
  - No full sample array or expanded artifact/event cardinality escapes the
    tested ceilings.
Completed: 2026-08-11

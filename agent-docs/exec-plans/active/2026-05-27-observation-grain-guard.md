# Observation Grain Guard

Status: active
Created: 2026-05-27
Updated: 2026-05-27

## Goal

- Separate raw dense telemetry admission from compact observation summary facts.
- Allow provider compact summaries through import guards without making admission depend on default query/search visibility.

## Success criteria

- Observation events can explicitly declare raw sample, summary, or derived-fact grain.
- Dense telemetry rejection applies to sample/raw observation events above the existing threshold.
- Junction compact summary observations are accepted without forcing `canonicalFact` or default query visibility.
- Focused regression tests cover a large compact summary backfill and dense sample rejection.

## Scope

- In scope: shared observation event contracts, core dense telemetry guard, Junction importer summary observations, focused importer/core tests, and durable docs if the contract is architecture-significant.
- Out of scope: changing default query visibility policy, changing raw attachment storage, or admitting raw timeseries into query/read/browser surfaces.

## Constraints

- Preserve overlapping active Junction and wearable query edits in the worktree.
- Do not expose raw health payloads, source paths, record ids, provider secrets, local paths, or direct identifiers.
- Keep the field small and declarative; avoid deriving product visibility from import-admission needs.

## Verification

- `pnpm typecheck`
- `pnpm test:diff <touched paths>` or owner package coverage lane, plus `pnpm test:smoke`
- Focused tests proving summary backfills pass and raw sample telemetry is rejected

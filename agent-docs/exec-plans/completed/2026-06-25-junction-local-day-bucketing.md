# Junction and WHOOP local day bucketing

## Goal

Fix and cover Junction-backed wearable summaries so provider-local day evidence
wins when Junction supplies timezone offset/date data, and records without
provider-local day evidence defer canonical day bucketing to the vault timezone
instead of hard-coding a UTC date prefix.

Also cover the direct WHOOP recovery edge case found in PR review: linked
recovery records must check all usable offset-bearing sources before falling
back to a UTC date prefix.

## Constraints

- Keep the fix provider-generic inside the Junction normalizer.
- Do not inspect or persist live provider payloads, account identifiers, tokens,
  secrets, or direct personal identifiers.
- Preserve existing compact daily timeseries behavior; those aggregates must
  still group before core import and already use offset metadata when present.
- Keep the change narrow to importer normalization and regression tests.

## Plan

1. Audit Junction summary/session day-key call sites for UTC-prefix fallback.
2. Add a small shared Junction helper for local day derivation from raw
   timestamp/date plus timezone offset metadata.
3. Update summary/session overrides to use provider-local day evidence or omit
   dayKey when only UTC timestamp evidence exists.
4. Add focused Junction regression tests for WHOOP-style UTC-midnight workout
   summaries with and without offset metadata.
5. Add direct-WHOOP recovery regression coverage for linked records where only
   the sleep source carries usable offset metadata.
6. Run focused importer tests and required repo verification, then close this
   plan with a scoped commit.

## Verification

- `pnpm --dir packages/importers exec vitest run --config vitest.config.ts --no-coverage test/device-providers-junction.test.ts`
- `pnpm --dir packages/importers exec vitest run --config vitest.config.ts --no-coverage test/device-providers.test.ts -t "WHOOP provider-local days"`
- `pnpm --filter @murphai/importers test`
- Required repo verification per completion workflow after final edits.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25

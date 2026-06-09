# Junction Meal Import

## Goal

Import Junction meal summaries as canonical Murph `meal` events while preserving raw evidence and stable source identity.

Success criteria:

- Junction `meal` is included in default summary imports and removed from raw-only summaries.
- Junction summary envelopes with a `meals` array unwrap into individual records.
- Junction meal summaries emit canonical `meal` events with stable `mealId`, ingredients, narrow nutrition totals, source provenance, and raw `junction-summary-meal` evidence.
- Existing activity, sleep, workout, body, cycle, and raw-only behavior remains unchanged.
- Tests cover meal normalization, stable IDs across corrections, vault import behavior, and resource allowlist changes.

## Scope

- `packages/importers/src/device-providers/junction-resources.ts`
- `packages/importers/src/device-providers/junction.ts`
- `packages/importers/test/device-providers-junction.test.ts`
- `packages/importers/test/device-providers.test.ts`
- `docs/device-provider-compatibility-matrix.md`

## Constraints

- Treat the supplied patch as behavior intent, not overwrite authority.
- Keep canonical writes routed through the existing device-batch import path.
- Keep micronutrients in raw evidence only.
- Preserve provider provenance without logging or committing provider tokens, raw credentials, direct personal identifiers, or local paths.
- Keep the implementation small and aligned with existing Junction normalization helpers.

## Verification

- `pnpm typecheck`
- `pnpm --dir packages/importers test:coverage`
- `pnpm --dir packages/device-syncd test:coverage`
- Direct static proof that the imported meal path still uses the device-batch importer/core path.
- `git diff --check`

## State

Ready for commit. Applied supplied patch with recount recovery, kept meal writes on the existing device-batch path, and fixed review findings before handoff:

- Default Junction summary resources now include `meal`; raw-only summaries no longer do.
- Junction `meal` envelopes unwrap from `meals`, direct webhook-style `data`/`items` envelopes split only when the outer object is not itself a meal record, and meal-internal itemized `data` remains internal.
- Canonical meal events preserve stable explicit provider/Junction IDs; no-ID duplicate fallback records in the same payload get deliberate per-payload disambiguators instead of colliding.
- Meal nutrition uses direct aggregate totals per field when present and item sums only to fill missing fields; item names are preserved even when item rows are name-only.
- Compatibility matrix docs now describe canonical Junction meal imports and raw-only micronutrient evidence.

Verification passed:

- `pnpm --dir packages/importers test -- device-providers-junction.test.ts`
- `pnpm --dir packages/importers test:coverage`
- `pnpm --dir packages/device-syncd test:coverage`
- `pnpm typecheck`
- `git diff --check`
- Diff identifier scan for local user/home path leakage.
Status: completed
Updated: 2026-06-09
Completed: 2026-06-09

# Supplement DSLD UPC Hydration

## Goal

Add a read-only dry-run path that can hydrate brand-site refetch candidates with structured DSLD facts when the official current product/variant has an exact UPC match.

Success criteria:

- The helper only reads the supplement DB and never writes it.
- Hydration is opt-in and requires exact UPC matches.
- Hydrated rows keep official brand-site provenance and add DSLD provenance for copied structured fields.
- Rows without trustworthy exact-match structured facts remain blocked/manual-review.
- Focused tests cover hydration shape and ambiguity/blocking behavior.

## Scope

- `.agents/skills/research-supplements/scripts/supplement-db-brand-site-refetch-preview.mjs`
- `.agents/skills/research-supplements/scripts/supplement-db-brand-site-refetch-preview.d.mts`
- `.agents/skills/research-supplements/SKILL.md`
- `scripts/supplement-db-brand-site-labels.test.ts`

## Verification

- `node --check .agents/skills/research-supplements/scripts/supplement-db-brand-site-refetch-preview.mjs`
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/supplement-db-brand-site-labels.test.ts --no-coverage`
- `pnpm typecheck`
- Read-only preview and DB dry-run against Bluebonnet candidates.

Observed Bluebonnet read-only preview with `--hydrate-dsld-upc`:

- 565 rows reviewed.
- 540 production-ready candidates.
- 540 candidates hydrated from exact UPC-matched DSLD structured facts.
- 25 candidates still blocked for manual review.
- The remaining blocked UPCs had zero exact DSLD rows; one blocked candidate had no UPC.

## Out Of Scope

- Writing supplement DB rows.
- Treating non-UPC, fuzzy name, or image-only matches as production-ready.
- Deleting existing raw evidence.
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07

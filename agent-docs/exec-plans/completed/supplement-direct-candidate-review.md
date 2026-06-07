# Supplement Direct Candidate Review

## Goal

Review the 47 direct brand-site repair candidates and only write candidates after parser/gate fixes prove they preserve single-product label data.

## Scope

- `.agents/skills/research-supplements/scripts/supplement-db-brand-site-repair-preview.mjs`
- `scripts/supplement-db-brand-site-labels.test.ts`
- Local dry-run artifacts under `/tmp/murph-supplement-audit`

## Constraints

- Do not write the 47 candidate rows as-is.
- Fix parser/gates for observed bad candidates first.
- Preserve raw evidence for candidates that remain lossy or metadata-ambiguous.

## Verification

- Repair preview regenerated for oversized brand-site rows: 97 reviewed, 47 automated backfill candidates, 0 proposed oversized search text rows.
- Candidate audit on the 47 found correct source brands, no page-body fields, ingredient rows and serving sizes present, and no stray IU-only rows.
- DB dry-run on the exact candidate artifact: 47 existing-row updates, 0 production blockers, 0 missing ingredient rows, 0 missing serving sizes, 0 oversized search text rows.
- DB upsert committed 47 rows.
- DB readback on the 47: 0 page-body rows, 0 oversized search text rows, 0 missing ingredient rows, 0 missing serving sizes, and fixed source brands.
- `node --check .agents/skills/research-supplements/scripts/supplement-db-brand-site-repair-preview.mjs` passed.
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/supplement-db-brand-site-labels.test.ts --no-coverage` passed.
- `pnpm typecheck` passed.
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07

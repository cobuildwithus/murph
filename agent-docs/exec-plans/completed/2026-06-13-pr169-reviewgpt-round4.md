# PR 169 ReviewGPT round 4 fixes

## Goal

Address the actionable ReviewGPT findings for PR 169 without expanding the
food-label architecture.

Success criteria:

- FDC imports accept both USDA display `data_type` values and existing
  snake-case fixture values.
- Prepared FDC exports include only rows from the latest staging import run for
  the selected release.
- Food CLI all-digit GTIN lookups try exact UPC before prefixed FDC IDs while
  preserving explicit `fdc:` ID lookup.
- Focused tests and typecheck pass.

## Constraints

- Preserve unrelated working-tree edits and active plans.
- Do not expose local user identifiers, secrets, raw database URLs, or home
  paths in committed artifacts.
- Keep the fix bounded to import/lookup behavior and direct regressions.

## Approach

1. Normalize FDC `data_type` values in the shell prefilter and SQL import.
2. Scope prepared export rows to the latest import timestamp for a release.
3. Add a food-label client option that prefers GTIN UPC lookup before numeric
   prefixed ID lookup only for foods.
4. Add focused regressions and run scoped verification plus typecheck.

## State

Completed locally; ready for scoped commit.

## Notes

- Vercel production now has `MURPH_LABELS_DB_URL` configured from the local
  labels-compatible database URL; future production deploys will pick it up.
- Coverage-write added test-only proof for food GTIN UPC-to-FDC fallback and
  snake-case SQL normalization coverage.
Status: completed
Updated: 2026-06-13
Completed: 2026-06-13

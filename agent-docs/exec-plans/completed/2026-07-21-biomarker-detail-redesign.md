# Production biomarker page redesign

Status: completed
Created: 2026-07-21
Updated: 2026-07-21

## Goal

- Apply the approved biomarker result-detail direction from `/design` to the
  production `/biomarkers/results/[metricKey]` route while preserving private
  browser-vault data ownership and the complete saved-result history.
- Simplify the production `/biomarkers` health-area contents to one full-width
  biomarker per row and keep the `/design` study aligned with that direction.

## Success criteria

- The production route uses the concise study hierarchy: biomarker name and
  description, latest status/value/date, then the numeric history chart.
- Redundant comparison and reference summary blocks are removed without losing
  truthful chart ranges or per-result reference/source context.
- The loading skeleton matches the redesigned structure on mobile and desktop.
- Saved-lab health areas use one calm, full-width result row at every viewport
  instead of a dense multi-column grid, while keeping full-row links and
  flagged-first ordering.
- Auth, loading, error, stale, empty, qualitative, comparator, incompatible-unit,
  and all-results behavior remain intact.
- Focused tests, canonical verification, responsive browser proof, required
  frontend and coverage audits, and final review have no unresolved findings.

## Scope

- In scope:
  - `apps/web/app/(dashboard)/biomarkers/results/[metricKey]/lab-biomarker-detail-client.tsx`.
  - `apps/web/app/(dashboard)/biomarkers/biomarkers-page-client.tsx` and the
    corresponding `/design` biomarker index study.
  - Focused biomarker history UI tests and only directly required supporting code.
  - `DESIGN.md` if the production result-detail contract changes materially.
- Out of scope:
  - Browser-vault schemas/selectors, persistence, auth, medical interpretation,
    or dependencies.

## Constraints

- Keep production member data in the existing browser-vault selector.
- A lab flag is source data, not a diagnosis; do not infer an in-range state when
  the source flag is absent.
- Preserve the complete result ledger, ranges, sources, and non-plottable context.
- Use the existing Tailwind/shadcn system and semantic tokens.

## Tasks

1. Audit the design study against production rendering and test contracts.
2. Implement the concise production result-detail hierarchy and matching skeleton.
3. Replace the measured-biomarker multi-column grid with one full-width row per
   result in production, the design study, and the loading skeleton.
4. Add or update focused preservation and layout coverage.
5. Run frontend preflight, responsive runtime proof, canonical verification, and audits.
6. Close the plan, commit, push, review, and merge through the normal PR lane.

## Verification

- Focused Vitest for lab biomarker history UI.
- ESLint on touched web files and `git diff --check`.
- `pnpm test:diff` over the touched production and test paths.
- `pnpm verify:acceptance` when selected by the completion workflow.
- Desktop and mobile route proof through the supported browser lane.
Completed: 2026-07-21

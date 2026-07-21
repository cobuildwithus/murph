# Production biomarker index redesign

Status: completed
Created: 2026-07-21
Updated: 2026-07-21

## Goal

- Apply the approved biomarker list direction to the production `/biomarkers`
  page while preserving private browser-vault data ownership and device-derived
  reading behavior.

## Success criteria

- The production page uses a concise heading plus search and status filters for
  measured lab biomarkers.
- Health-area sections start expanded, keep full-cell links to private histories,
  and sort flagged results before in-range and unflagged results.
- Measured lab cells render in one column on phones, two on standard desktop,
  and three on wide viewports without empty decorative cells.
- Device readings, auth, loading, error, stale, empty, and unclassified-result
  behavior stay intact.
- Focused tests, canonical verification, browser proof where available, required
  frontend and coverage audits, and final review have no unresolved findings.

## Scope

- In scope:
  - `apps/web/app/(dashboard)/biomarkers/biomarkers-page-client.tsx`.
  - Focused biomarker index tests and only directly required supporting code.
  - `DESIGN.md` and the measured-biomarker index product spec where the
    approved production contract changed.
- Out of scope:
  - Browser-vault schemas/selectors, persistence, auth, device classification,
    production biomarker detail routes, medical interpretation, or dependencies.

## Constraints

- Keep production member data in the existing browser-vault selectors.
- A lab flag is source data, not a diagnosis; use neutral labels and do not infer
  in-range state when the source flag is absent.
- Preserve the existing `From your devices` section and its cards.
- Use the existing shadcn/Tailwind system and semantic tokens.

## Tasks

1. Audit production data, rendering, and test contracts.
2. Implement the compact responsive lab index and interactions.
3. Add focused layout, filtering, sorting, and preservation coverage.
4. Run frontend preflight, runtime proof, canonical verification, and audits.
5. Close the plan and create the scoped commit and normal PR-lane handoff.

## Verification

- Focused Vitest for lab history UI and device metrics.
- ESLint on touched web files and `git diff --check`.
- `pnpm test:diff` over the touched production and test paths.
- `pnpm verify:acceptance` when selected by the completion workflow.
- Desktop, wide, and mobile route proof where the supported browser lane is
  available.
Completed: 2026-07-21

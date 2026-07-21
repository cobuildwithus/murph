# Biomarker skeleton alignment

Status: completed
Created: 2026-07-21
Updated: 2026-07-21

## Goal

- Make the production `/biomarkers` loading skeleton use the same one-, two-,
  and three-column partitioning as the loaded biomarker cells.

## Success criteria

- The third placeholder spans both columns at `md` and returns to one cell at
  `xl`, so the loading state has no empty decorative slot.
- Warm separators match the loaded grid without changing its data or behavior.
- Focused verification and required review gates pass on the new PR head.

## Scope

- `apps/web/app/(dashboard)/biomarkers/biomarkers-page-client.tsx`.
- The focused page-loading assertion.

## Verification

- Focused biomarker page Vitest and ESLint.
- `pnpm test:diff` for the touched web surface.
- Frontend review and the PR ReviewGPT loop on the pushed head.
Completed: 2026-07-21

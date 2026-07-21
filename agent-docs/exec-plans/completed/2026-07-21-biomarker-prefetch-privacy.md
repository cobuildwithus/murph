# Biomarker link prefetch privacy

Status: completed
Created: 2026-07-21
Updated: 2026-07-21

## Goal

- Keep expanded saved-biomarker sections private until the member deliberately
  opens a result page.

## Success criteria

- Production saved-biomarker links disable automatic Next.js prefetch.
- Focused coverage proves every rendered result link carries
  `prefetch={false}` while remaining a native, full-cell link.
- Required verification and ReviewGPT correction review pass on the pushed
  remediation head.

## Scope

- `apps/web/app/(dashboard)/biomarkers/biomarkers-page-client.tsx`.
- `apps/web/test/lab-biomarker-history-ui.test.tsx`.

## Verification

- `pnpm --dir apps/web test:prepared test/lab-biomarker-history-ui.test.tsx`
  (17 tests passed).
- Focused ESLint for the edited component and test (zero warnings or errors).
- `pnpm test:diff` for the touched web surface (6,012 tests passed; TypeScript,
  dev smoke, lint, and production build passed; 10 unrelated existing lint
  warnings and one existing Turbopack trace warning remained).
- ReviewGPT correction round on the pushed head.
Completed: 2026-07-21

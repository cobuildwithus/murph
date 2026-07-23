# Biomarker chart overflow

Status: completed
Created: 2026-07-23
Updated: 2026-07-22

## Goal

Make the responsive biomarker history chart incapable of widening its page
during the initial Recharts measurement pass, so the PR's viewport-overflow
guard is green at tablet and desktop widths without changing chart semantics.

## Success criteria

- The design Sections page has no horizontal document overflow at 768px or
  1280px.
- The usage-credit owner and Add usage action remain contained and unchanged.
- Biomarker charts keep their existing height, labels, bounds, tooltips, and
  post-measurement responsive dimensions.
- Focused Playwright, Web tests/typecheck/lint, canonical verification, CI, and
  a correction ReviewGPT round pass on the pushed head.

## Root-cause evidence

- The exact Playwright guard reproduced locally with document widths of 825px
  at a 768px viewport and 1445px at a 1280px viewport.
- The usage-credit owner itself measured 638px inside its 768px layout and its
  Add usage button remained inside the owner.
- The only escaping elements were three `.recharts-wrapper` nodes, each seeded
  with the history chart's fixed 760px `initialDimension` before
  `ResizeObserver` supplied the real container width.

## Verification evidence

- `VIEWPORT_OVERFLOW_PORT=4330 pnpm --dir apps/web test:viewport-overflow
  --grep "personal usage-credit owner"`: passed at 768px and 1280px.
- The complete Playwright command reached and passed both design-page cases in
  ordinary and CI-mode runs. The remaining local-only failures were
  `/growth` execution-context destruction after its hosted onboarding redirect,
  not overflow assertions; the prior GitHub run passed all five `/growth`
  widths and failed only on the chart-driven 825px and 1445px document widths.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts
  apps/web/test/lab-biomarker-history-chart-contract.test.tsx --no-coverage`:
  7 tests passed.
- `pnpm --dir apps/web typecheck`: passed.
- Targeted ESLint for the chart component and contract test: passed.
- `MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance`: passed in
  Testbox `tbx_01ky6fpar9kveynez20gbybkf1` (4m30s total; linked GitHub Actions
  run 29976653263).

## Tasks

1. Replace the desktop-width seed with a positive non-constraining initial
   width that Recharts can replace after its first container measurement.
2. Preserve the existing viewport guard and add focused contract proof if the
   responsive seed is not otherwise visible to tests.
3. Run focused Playwright and repository verification.
4. Close the plan, commit, push, update PR evidence, and run ReviewGPT on the
   new exact head.
Completed: 2026-07-22

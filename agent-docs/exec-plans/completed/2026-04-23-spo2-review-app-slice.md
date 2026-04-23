## SpO2 review app slice

Status: completed
Created: 2026-04-23
Updated: 2026-04-24

## Goal

- Land only the applicable app-side slice of the downloaded `spo2-review-improvements.patch` on this checkout.

## Success criteria

- Percent-based biomarker trend deltas use percentage-point wording.
- Percent-based biomarker direction classification uses the raw delta instead of rounded display precision.
- Non-percent biomarkers keep their existing flat/up/down wording and rounded-direction behavior.
- Focused app proof and the diff-aware verification lane both pass.
- Any skipped content/change-log hunks from the downloaded artifact are explained as checkout-specific applicability blockers rather than recreated speculatively.

## Scope

- In scope: `apps/web/app/biomarkers/[biomarkerId]/biomarker-page-client.tsx`, `apps/web/test/health-commons-biomarker-page-client.test.ts`, and local plan/ledger bookkeeping.
- Out of scope: authored SpO₂ content/source files, Health Commons redirects/change-log/generated artifacts, or broader biomarker-page redesign.

## Applicability notes

- The downloaded review patch assumed an earlier authored SpO₂ landing that is not present in this checkout under `packages/health-commons/content/**`.
- The app-side formatter/classification seam was applicable and is now landed.
- The content/change-log hunks were intentionally skipped because their prerequisite authored source baseline is absent here.

## Outcome

- `biomarker-page-client.tsx` now renders percentage-point summary copy only for percent-unit biomarkers and uses the raw delta only for percent-unit direction classification.
- Non-percent biomarkers keep the previous `flat/up/down <value> <unit>` summary behavior.
- `health-commons-biomarker-page-client.test.ts` now proves the flat-percent wording, the percent raw-delta edge case, the exported percent-helper seam, and the preserved VO₂/deep-sleep non-percent behavior.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/health-commons-biomarker-page-client.test.ts`
- `pnpm test:diff 'apps/web/app/biomarkers/[biomarkerId]/biomarker-page-client.tsx' apps/web/test/health-commons-biomarker-page-client.test.ts`
- The diff-aware lane completed `apps/web verify`.
- `git diff --check -- 'apps/web/app/biomarkers/[biomarkerId]/biomarker-page-client.tsx' apps/web/test/health-commons-biomarker-page-client.test.ts agent-docs/exec-plans/active/COORDINATION_LEDGER.md agent-docs/exec-plans/active/2026-04-23-spo2-review-app-slice.md`

## Audits

- `frontend-review`: no findings; residual human-only gap is checking narrow-width wrapping for the longer percentage-point copy.
- `coverage-write`: no missing proof gap; no file changes.
- `task-finish-review`: no findings; noted the same narrow-width human-only UI gap plus the skipped content/change-log applicability assumption.

## Commit note

- No scoped commit was created in this turn because the shared `COORDINATION_LEDGER.md` file carries unrelated concurrent churn from other active rows, so staging it would absorb unrelated in-flight work.
Completed: 2026-04-24

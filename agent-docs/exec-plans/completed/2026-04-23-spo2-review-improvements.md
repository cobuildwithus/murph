# SpO2 review improvements

Status: completed
Created: 2026-04-23
Updated: 2026-04-24

## Goal

- Land the supplied SpO₂ follow-up review patch so the biomarker page exposes explicit evidence claims, the trend delta copy uses percentage-point wording for percent units, and the directly coupled tests and generated Health Commons outputs stay consistent.

## Success criteria

- The authored SpO₂ biomarker page includes the new claim blocks from the follow-up patch.
- The biomarker trend card formats percent deltas as percentage-point changes and classifies near-flat percent deltas from the raw value rather than the rounded display value.
- The directly coupled `apps/web` tests cover the new copy and helper behavior.
- Health Commons generated artifacts and the April change log include the follow-up change entry, or any blocker is named precisely.
- A scoped commit is created only if the shared dirty tree allows staging the exact touched slice without absorbing unrelated active biomarker work.

## Scope

- In scope: `apps/web/app/biomarkers/[biomarkerId]/biomarker-page-client.tsx`, directly coupled biomarker tests, `packages/health-commons/content/biomarkers/blood-oxygen-spo2.md`, the April Health Commons change log entry, directly required generated Health Commons artifacts, and plan/ledger bookkeeping.
- Out of scope: broader biomarker UI redesign, new biomarker pages, unrelated Health Commons content cleanup, and any attempt to untangle overlapping VO₂ / HRV / REM generated-artifact churn outside the exact SpO₂ slice.

## Constraints

- Preserve unrelated dirty-tree edits and treat the supplied patch as behavioral intent rather than overwrite authority.
- Keep the follow-up limited to the existing SpO₂ biomarker lane plus the directly coupled percent-delta formatter seam.
- Avoid exposing direct personal identifiers in docs, code, logs, or commit metadata.

## Risks and mitigations

1. Risk: the supplied patch targets an older file layout and adds standalone test files that now overlap broader committed biomarker test suites.
   Mitigation: port the intended assertions into the current files instead of replaying stale hunks literally.
2. Risk: the follow-up touches shared generated outputs and the shared monthly change log that already overlap other in-flight biomarker rows.
   Mitigation: regenerate and verify the exact slice, but only create a scoped commit if the resulting staged set can be separated safely from the other active rows.

## Tasks

1. Register the narrow follow-up lane in the coordination ledger.
2. Port the stale patch onto the current app/content/test file layout.
3. Regenerate Health Commons artifacts and inspect overlap carefully.
4. Run truthful scoped verification plus required completion audits.
5. Commit the exact touched slice only if it can be staged safely in the shared dirty tree.

## Decisions

- Keep the existing authored SpO₂ page and source set, and layer the follow-up claims/copy changes on top of that current source instead of replaying the stale patch literally.
- Reuse the current biomarker test files by extending their SpO₂ assertions rather than adding new standalone test files.

## Verification

- Planned commands:
  - `pnpm --dir packages/health-commons generate`
  - `pnpm --dir packages/health-commons verify`
  - `pnpm --dir apps/web exec vitest run test/health-commons-biomarker-detail-page.test.ts test/health-commons-biomarker-page-client.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm --dir apps/web lint`
  - `pnpm --dir apps/web typecheck`
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/health-commons/content/biomarkers/blood-oxygen-spo2.md packages/health-commons/content/sources/spo2/fda-pulse-oximeter-basics-2025.md packages/health-commons/content/sources/spo2/fda-pulse-oximeter-skin-tone-guidance-2025.md packages/health-commons/content/sources/spo2/pmid-29262014.md packages/health-commons/content/sources/spo2/mayo-hypoxemia-pulse-oximetry.md packages/health-commons/content/sources/spo2/cleveland-clinic-blood-oxygen-level.md packages/health-commons/content/sources/spo2/pmid-28162150.md packages/health-commons/content/redirects.json packages/health-commons/content/changes/2026-04.jsonl packages/health-commons/generated/catalog.hash packages/health-commons/generated/catalog.json packages/health-commons/generated/entities.ndjson packages/health-commons/generated/recent-changes.json apps/web/app/biomarkers/[biomarkerId]/biomarker-page-client.tsx apps/web/test/health-commons-biomarker-detail-page.test.ts apps/web/test/health-commons-biomarker-page-client.test.ts`
  - `git diff --check`

## Outcome

- Ported the stale SpO₂ follow-up patch onto the current file layout instead of replaying outdated standalone test-file hunks.
- Added authored SpO₂ claims so the evidence section can render source-backed claim cards, and added the follow-up Health Commons change-log entry.
- Narrowed the app change to percent-unit behavior only: percent deltas now use percentage-point wording and raw-delta flat classification, while non-percent biomarker copy stays unchanged.
- Tightened the routed page/model/render tests so the SpO₂ claims are proved at the authored-content, page-model, and page-client render boundaries.
- Required completion audits:
  - `coverage-write` found current coverage sufficient and made no changes.
  - `frontend-review` found no material issues; residual human gap is a manual mobile/desktop viewport pass.
  - `task-finish-review` found one medium test gap around page-boundary proof for claims; it was fixed locally and the affected checks were rerun green.
- Verification passed with:
  - `pnpm --dir packages/health-commons generate`
  - `pnpm --dir packages/health-commons verify`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/health-commons-biomarker-detail-page.test.ts apps/web/test/health-commons-biomarker-page-client.test.ts`
  - `pnpm --dir apps/web lint` (warnings only, no errors)
  - `pnpm --dir apps/web typecheck`
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff ...`
  - `git diff --check`
- No scoped commit was created. `packages/health-commons/content/changes/2026-04.jsonl` and the generated Health Commons artifacts still overlap other active biomarker rows in this shared working tree, so staging the exact SpO₂ follow-up slice would absorb unrelated in-flight work.
Completed: 2026-04-24

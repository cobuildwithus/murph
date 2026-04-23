# SpO2 biomarker landing

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Land the supplied SpO₂ biomarker Health Commons patch so the page resolves through the existing biomarker route, with authored source pages, redirect/change metadata, the coupled percent-threshold UI fix, and current generated catalog outputs.

## Success criteria

- The SpO₂ biomarker markdown page and supporting source pages are present under `packages/health-commons/content/**`.
- The catalog includes the new biomarker, the short `biomarker:spo2` route resolves to the canonical entity, and the app publishes the page.
- The biomarker page client uses a sensible near-flat threshold for percent-based trends so SpO₂ deltas are not mislabeled as directional noise.
- Scoped verification for the touched Health Commons and `apps/web` slice passes, or any unrelated blocker is named precisely.
- A scoped commit is created only if the overlapping Health Commons generated/change files can be staged without absorbing the active REM sleep lane.

## Scope

- In scope: the supplied SpO₂ biomarker/source content, the 2026-04 Health Commons change record entry, a redirect for the short `spo2` route, directly required generated Health Commons artifacts, the biomarker trend threshold helper, biomarker route tests, and plan/ledger bookkeeping.
- Out of scope: broader biomarker UI redesign, unrelated Health Commons content refreshes, schema changes, and any attempt to clean up or absorb the active REM sleep lane.

## Constraints

- Technical constraints: preserve current Health Commons schema/frontmatter conventions, keep the biomarker route data-driven, and port only the directly coupled app/test changes required for SpO₂.
- Product/process constraints: preserve unrelated dirty-tree edits, do not expose direct personal identifiers in repo files or commit metadata, and do not commit shared generated/change files if the overlap with the REM sleep lane cannot be separated safely.

## Risks and mitigations

1. Risk: the supplied content assumes a new biomarker while the branch already carries an active REM sleep biomarker lane touching the same shared Health Commons outputs.
   Mitigation: inspect shared-file diffs before and after generation, preserve the REM entries verbatim, and avoid a scoped commit if the resulting generated state cannot be attributed safely.
2. Risk: the supplied route naming is inconsistent between shorthand `spo2` references and the authored canonical slug `blood-oxygen-spo2`.
   Mitigation: keep the descriptive canonical page key/slug from the supplied content and add a redirect from `biomarker:spo2`.

## Tasks

1. Register the task in the coordination ledger and capture the scoped plan.
2. Add the SpO₂ biomarker/source pages plus redirect and change metadata.
3. Patch the biomarker-page percent trend threshold and extend route coverage.
4. Regenerate Health Commons outputs and inspect shared-file scope carefully.
5. Run targeted verification and decide whether a scoped commit is safe in the current dirty tree.

## Decisions

- Keep `biomarker:blood-oxygen-spo2` as the canonical entity and add a `biomarker:spo2` redirect for the short route.
- Split the overlapping percent-threshold/copy follow-up in `apps/web/app/biomarkers/[biomarkerId]/biomarker-page-client.tsx` into `agent-docs/exec-plans/active/2026-04-23-spo2-review-improvements.md` so this landing can stay scoped to the authored content/generated slice plus the canonical route redirect.

## Verification

- Commands to run:
  - `pnpm --dir packages/health-commons generate`
  - `pnpm --dir packages/health-commons verify`
  - `pnpm --dir apps/web exec vitest run test/health-commons-biomarker-detail-page.test.ts --config vitest.config.ts --no-coverage`
  - `bash scripts/workspace-verify.sh test:diff packages/health-commons/content/biomarkers/blood-oxygen-spo2.md packages/health-commons/content/sources/spo2/fda-pulse-oximeter-basics-2025.md packages/health-commons/content/sources/spo2/fda-pulse-oximeter-skin-tone-guidance-2025.md packages/health-commons/content/sources/spo2/pmid-29262014.md packages/health-commons/content/sources/spo2/mayo-hypoxemia-pulse-oximetry.md packages/health-commons/content/sources/spo2/cleveland-clinic-blood-oxygen-level.md packages/health-commons/content/sources/spo2/pmid-28162150.md packages/health-commons/content/redirects.json packages/health-commons/content/changes/2026-04.jsonl packages/health-commons/generated/catalog.hash packages/health-commons/generated/catalog.json packages/health-commons/generated/entities.ndjson packages/health-commons/generated/recent-changes.json apps/web/app/biomarkers/[biomarkerId]/biomarker-page-client.tsx apps/web/test/health-commons-biomarker-detail-page.test.ts`
  - `git diff --check`
- Expected outcomes:
  - The new biomarker and sources parse cleanly and appear in generated catalog outputs.
  - The app publishes the new biomarker route and route tests cover the new page plus the short redirect.
  - Verification is green, or any remaining failure is attributable to unrelated pre-existing overlap in the dirty tree.

## Outcome

- Added the authored SpO2 biomarker page and source artifacts, the short `biomarker:spo2` redirect metadata, the April change-log entry, and the directly required generated catalog outputs.
- Landed the canonical route behavior at the page boundary by redirecting `/biomarkers/spo2` to `/biomarkers/blood-oxygen-spo2` in `apps/web/app/biomarkers/[biomarkerId]/page.tsx`, with matching route coverage in `apps/web/test/health-commons-biomarker-detail-page.test.ts`.
- Left the overlapping percent-threshold/copy follow-up in `apps/web/app/biomarkers/[biomarkerId]/biomarker-page-client.tsx` and `apps/web/test/health-commons-biomarker-page-client.test.ts` for the separate active `2026-04-23-spo2-review-improvements` lane.
- Regenerated Health Commons outputs successfully and verified the scoped landing with:
  - `pnpm --dir packages/health-commons generate`
  - `pnpm --dir packages/health-commons verify`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/health-commons-biomarker-detail-page.test.ts apps/web/test/experiment-detail-protocol-tab.test.ts`
  - `pnpm --dir apps/web typecheck`
  - `pnpm test:smoke`
  - `git diff --check -- apps/web/app/biomarkers/[biomarkerId]/page.tsx apps/web/src/lib/health-commons/experiment-detail.ts apps/web/test/health-commons-biomarker-detail-page.test.ts apps/web/test/experiment-detail-protocol-tab.test.ts packages/health-commons/content/biomarkers/estimated-vo2max.md packages/health-commons/content/biomarkers/blood-oxygen-spo2.md packages/health-commons/content/changes/2026-04.jsonl packages/health-commons/content/redirects.json packages/health-commons/content/sources/spo2 packages/health-commons/content/sources/vo2-max packages/health-commons/generated/catalog.hash packages/health-commons/generated/catalog.json packages/health-commons/generated/entities.ndjson packages/health-commons/generated/recent-changes.json packages/health-commons/generated/redirects.json`
- Broader `pnpm typecheck` and `bash scripts/workspace-verify.sh test:diff ...` remain red on unrelated `apps/cloudflare` and `packages/assistant-engine` work, so they were not used as the commit gate for this landing.
Completed: 2026-04-23

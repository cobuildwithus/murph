# HRV biomarker landing

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Land the supplied HRV / RMSSD biomarker patch so the public biomarker page, supporting Health Commons source artifacts, and biomarker research-notes rendering integrate cleanly on current `HEAD`.

## Success criteria

- The HRV / RMSSD biomarker markdown page and supporting HRV source artifacts are present under `packages/health-commons/content/**`.
- The biomarker page publishes the long-form research memo from the biomarker body without regressing the newer evidence-map UI already in `apps/web`.
- The HRV biomarker becomes a publishable Health Commons biomarker route with private metric bindings, claims, protocol ranking, and community-outcome placeholder.
- Directly required generated Health Commons artifacts are current and scoped to the landed content.
- Scoped verification and mandatory audit passes complete, or any unrelated blocker is named precisely.
- A scoped commit contains only the task-owned files plus plan and ledger closeout.

## Scope

- In scope: the supplied HRV biomarker/source content files, the 2026-04 Health Commons change record entry, directly required generated Health Commons artifacts, the biomarker-page research-notes rendering/data-model changes in `apps/web`, directly coupled biomarker page tests, and plan/ledger bookkeeping.
- Out of scope: unrelated biomarker/content refreshes, other active Health Commons landings, broader biomarker-page redesign, new wearable/query plumbing beyond existing HRV metric bindings, and unrelated dirty-tree work elsewhere in the repo.

## Constraints

- Technical constraints: preserve current Health Commons schema/frontmatter conventions, keep the public key and route on `biomarker:hrv-rmssd` / `/biomarkers/hrv-rmssd`, treat the supplied patch as intent rather than overwrite authority, and merge the research-notes UI onto the newer evidence-map-capable biomarker page client instead of replaying stale hunks.
- Product/process constraints: preserve unrelated dirty-tree edits, do not expose direct personal identifiers in repo files or commit metadata, keep the `changes/2026-04.jsonl` edit narrowly additive, and use the repo plan/ledger plus scoped commit workflow.

## Risks and mitigations

1. Risk: the supplied patch no longer applies cleanly because `apps/web/app/biomarkers/[biomarkerId]/biomarker-page-client.tsx`, `packages/health-commons/content/changes/2026-04.jsonl`, and `packages/health-commons/generated/**` already carry overlapping in-progress edits.
   Mitigation: port only the minimal HRV-specific hunks onto current files, inspect generated diffs carefully, and stop if shared overlap cannot be scoped confidently.
2. Risk: the generated Health Commons artifacts could absorb unrelated active biomarker churn if regenerated blindly.
   Mitigation: regenerate from the current working tree only after the HRV content lands, then compare the resulting generated diffs against the authored HRV changes and existing tracked overlap.
3. Risk: commit scoping could accidentally capture unrelated active work because some shared files are already dirty.
   Mitigation: inspect the commit-helper behavior early, stage only the task-owned hunks where needed, and stop before commit if the repo tooling cannot isolate this task safely.

## Tasks

1. Register the task in the coordination ledger and inspect the supplied patch against current `HEAD`.
2. Apply or minimally port the HRV biomarker patch without widening scope.
3. Regenerate only the directly required Health Commons artifacts and inspect overlap carefully.
4. Run the required scoped verification and direct proof for the touched app/package/content surfaces.
5. Run the mandatory completion audits for this standard repo change, address findings, and create a scoped commit if it can be isolated safely.

## Decisions

- Use a dedicated active plan because this supplied patch spans authored content files plus `apps/web` code in a dirty tree with overlapping active biomarker rows.
- Keep the existing evidence-map section and add the body-driven research-notes section as a complementary read rather than replacing the claims/source UI.
- Treat the existing HRV wearable/query metric support as sufficient; the landing is content-driven plus page rendering.

## Verification

- Commands to run:
- `git apply --check <supplied-patch>`
- `pnpm --dir packages/health-commons generate`
- `pnpm --dir packages/health-commons verify`
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/health-commons-biomarker-detail-page.test.ts apps/web/test/health-commons-biomarker-page-client.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/web/app/biomarkers/[biomarkerId]/biomarker-page-client.tsx apps/web/test/health-commons-biomarker-detail-page.test.ts apps/web/test/health-commons-biomarker-page-client.test.ts packages/health-commons/content/biomarkers/hrv-rmssd.md packages/health-commons/content/changes/2026-04.jsonl packages/health-commons/content/sources/hrv packages/health-commons/generated/catalog.hash packages/health-commons/generated/catalog.json packages/health-commons/generated/entities.ndjson packages/health-commons/generated/recent-changes.json`
- `pnpm test:smoke`
- `git diff --check`
- Expected outcomes:
- The supplied patch lands cleanly or is minimally ported with equivalent behavior/content.
- The affected Health Commons content, generated artifacts, and biomarker page behavior are current and scoped.
- The touched UI/content surfaces pass the truthful verification lane.
- Any remaining failed check, if present, is attributable to a precise unrelated blocker rather than this diff.
- Observed outcomes:
- `git apply --check` failed against current `HEAD`, so the landing was ported manually onto the current biomarker-page client and current Health Commons content tree.
- `pnpm --dir packages/health-commons generate` passed.
- `pnpm --dir packages/health-commons verify` passed.
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/health-commons-biomarker-detail-page.test.ts apps/web/test/health-commons-biomarker-page-client.test.ts` passed after adding the HRV route expectation and the research-notes follow-up assertions.
- `pnpm --dir apps/web typecheck` passed after the calmer appendix-style research-notes follow-up.
- `pnpm --dir apps/web verify` passed after the follow-up, including full hosted-web Vitest coverage, lint (warnings only), and the dev smoke/build lane.
- `bash scripts/workspace-verify.sh test:diff ...` now fails for a credibly unrelated pre-existing workspace-boundary violation in `apps/cloudflare/test/hosted-local-linq-cold-start-repro.e2e.test.ts`, not for the HRV biomarker paths.
- `pnpm typecheck` rerun ultimately failed for a credibly unrelated pre-existing `packages/vault-usecases` typecheck problem (`Cannot find module '@murphai/core'`) in the dirty checkout, not for the HRV biomarker paths.
- `pnpm test:smoke` passed before the final client-only follow-up; the follow-up was limited to the biomarker page client/test surface and then covered by `apps/web verify`.
- `git diff --check` passed after the follow-up edits.
- Direct proof confirmed the published biomarker routes include `hrv-rmssd` and that the resolved detail model exposes the expected title, route id, and private browser-vault HRV binding.

## Closeout notes

- Required completion audits run so far:
- `coverage-write`: no additional changes requested.
- `frontend-review`: flagged ordered-list support, inline markdown rendering, and overly busy research-notes layout; all three follow-ups were addressed in the biomarker page client/tests.
- `task-finish-review`: one low-severity verification-gap note (`apps/web verify`) and no code defects; the missing `apps/web verify` run was completed and passed.
- A scoped commit is created only after isolating the overlapping VO2/SpO2 biomarker inputs, regenerating the shared Health Commons artifacts for the HRV-only state, and then restoring the overlapping work on top of the new commit.
Completed: 2026-04-23

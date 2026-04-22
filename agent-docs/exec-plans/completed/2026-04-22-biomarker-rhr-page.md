# Biomarker RHR page patch landing

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

- Recreate and land the resting-heart-rate biomarker page patch from the supplied RTF-backed implementation trace.
- Add the typed Health Commons biomarker schema surface, richer RHR biomarker content, generated catalog updates, and the new hosted-web `/biomarkers/[biomarkerId]` route.

## Success criteria

- `packages/contracts/src/health-commons.ts` exposes the biomarker-specific schema/types used by the page.
- `packages/health-commons/content/biomarkers/resting-heart-rate.md` carries the richer structured RHR metadata and ranking inputs.
- `packages/health-commons/generated/{catalog.hash,catalog.json,entities.ndjson}` reflect the RHR biomarker updates only.
- `apps/web/src/lib/health-commons/biomarker-detail.ts` resolves biomarker detail pages and ranked protocol candidates cleanly from Health Commons.
- `apps/web/app/biomarkers/[biomarkerId]/**` renders the biomarker page with private browser-vault overlays and public protocol ranking/community placeholder sections.
- Verification and required completion audits run, or any unrelated blockers are named precisely.

## Scope

- In scope: `packages/contracts/src/health-commons.ts`, `packages/health-commons/content/biomarkers/resting-heart-rate.md`, directly coupled generated Health Commons artifacts, `apps/web/src/lib/health-commons/biomarker-detail.ts`, `apps/web/app/biomarkers/[biomarkerId]/**`, and directly coupled tests if needed.
- Out of scope: broad Health Commons schema refactors beyond the biomarker page seam, experiment-detail UI changes, unrelated generated-catalog churn, and unrelated active `apps/web` or hosted-runtime work.

## Constraints

- Preserve unrelated dirty-tree edits, especially the pre-existing `apps/web/next-env.d.ts` change.
- Do not overwrite or revert overlapping `apps/web` and Health Commons work outside this patch scope.
- Keep the route aligned with existing browser-vault and Health Commons catalog patterns rather than inventing a parallel data model.

## Tasks

1. [ ] Register the narrow plan and ledger lane.
2. [ ] Apply the contracts and RHR Health Commons content changes from the RTF trace.
3. [ ] Update the directly coupled generated Health Commons artifacts for the RHR biomarker only.
4. [ ] Add the biomarker resolver and hosted-web route/client.
5. [ ] Run focused verification and required completion audits.
6. [ ] Create a scoped commit.

## Verification

- Planned: `pnpm typecheck`
- Planned: `bash scripts/workspace-verify.sh test:diff packages/contracts/src/health-commons.ts packages/health-commons/content/biomarkers/resting-heart-rate.md packages/health-commons/generated/catalog.hash packages/health-commons/generated/catalog.json packages/health-commons/generated/entities.ndjson apps/web/src/lib/health-commons/biomarker-detail.ts 'apps/web/app/biomarkers/[biomarkerId]/page.tsx' 'apps/web/app/biomarkers/[biomarkerId]/biomarker-page-client.tsx'`
- Planned: direct catalog/ranking readback for `biomarker:resting-heart-rate`
Completed: 2026-04-22

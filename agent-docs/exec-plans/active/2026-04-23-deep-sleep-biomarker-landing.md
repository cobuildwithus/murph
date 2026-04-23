# Deep sleep biomarker landing

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Land the supplied deep sleep biomarker patch so the public biomarker page, supporting Health Commons sources, and biomarker evidence rendering integrate cleanly on current `HEAD`.

## Success criteria

- The deep sleep biomarker markdown page and supporting source artifacts are present under `packages/health-commons/content/**`.
- The biomarker detail model and biomarker page publish the new evidence-map data for source-backed claims without regressing existing biomarker behavior.
- Directly required generated Health Commons artifacts are current and scoped to the landed content.
- Scoped verification and mandatory audit passes complete, or any unrelated blocker is named precisely.
- A scoped commit contains only the task-owned files plus plan and ledger closeout.

## Scope

- In scope: the supplied deep sleep biomarker/source content files, the 2026-04 Health Commons change record entry, directly required generated Health Commons artifacts, the biomarker evidence rendering/data-model changes in `apps/web`, and plan/ledger bookkeeping.
- Out of scope: unrelated biomarker/content refreshes, other active Health Commons landings, broader biomarker-page redesign, new wearable/query plumbing beyond the authored metric binding in the content model, and unrelated dirty-tree work elsewhere in the repo.

## Constraints

- Technical constraints: preserve existing Health Commons schema/frontmatter conventions, keep the public key and route on `biomarker:deep-sleep-minutes` / `/biomarkers/deep-sleep-minutes`, treat the supplied patch as intent rather than overwrite authority, and port only the directly coupled `apps/web` evidence-model changes required by the new page.
- Product/process constraints: preserve unrelated dirty-tree edits, do not expose direct personal identifiers in repo files or commit metadata, keep the `changes/2026-04.jsonl` edit narrowly additive, and use the repo plan/ledger plus scoped commit workflow.

## Risks and mitigations

1. Risk: the supplied patch no longer applies cleanly because `apps/web/app/biomarkers/[biomarkerId]/biomarker-page-client.tsx`, `apps/web/src/lib/health-commons/biomarker-detail.ts`, `packages/health-commons/content/changes/2026-04.jsonl`, and `packages/health-commons/generated/**` already carry overlapping in-progress edits.
   Mitigation: dry-run the patch first, then port only the minimal conflicting hunks and inspect generated diffs carefully before staging.
2. Risk: regenerated Health Commons artifacts may pick up overlapping active biomarker churn that is not safely attributable to this task.
   Mitigation: compare regenerated outputs against the authored deep-sleep content changes and stop if shared generated overlap cannot be scoped confidently.
3. Risk: verification may surface unrelated pre-existing failures from the already-dirty tree.
   Mitigation: prefer the truthful scoped verification lane, record exact failing commands and targets, and confirm whether each failure is attributable to this diff before handoff.

## Tasks

1. Register the task in the coordination ledger and inspect the supplied patch against current `HEAD`.
2. Apply or minimally port the deep sleep biomarker patch without widening scope.
3. Regenerate only the directly required Health Commons artifacts and inspect overlap carefully.
4. Run the required scoped verification and direct proof for the touched app/package/content surfaces.
5. Run the mandatory completion audits for this standard repo change, address findings, and create a scoped commit.

## Decisions

- Use a dedicated active plan because this supplied patch spans multiple authored content files plus `apps/web` code in a dirty tree with overlapping active biomarker rows.
- Treat the Evidence map section as a data-driven extension of the current biomarker page, not a broader UI redesign.
- Scope the shared Health Commons generated outputs by rebuilding from a temporary HEAD-exported `packages/health-commons` content baseline plus only the deep-sleep overlay, then stage just the resulting `changes`, `catalog.hash`, `catalog.json`, and `recent-changes.json` hunks.

## Verification

- Commands to run:
- `git apply --check <supplied-patch>`
- `git apply <supplied-patch>` or equivalent minimal manual port
- `pnpm --dir packages/health-commons generate`
- `pnpm --dir packages/health-commons verify`
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/health-commons-biomarker-detail-page.test.ts apps/web/test/health-commons-biomarker-page-client.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/web/app/biomarkers/[biomarkerId]/biomarker-page-client.tsx apps/web/src/lib/health-commons/biomarker-detail.ts packages/health-commons/content/biomarkers/deep-sleep-minutes.md packages/health-commons/content/changes/2026-04.jsonl packages/health-commons/content/sources/deep-sleep packages/health-commons/generated/catalog.hash packages/health-commons/generated/catalog.json packages/health-commons/generated/entities.ndjson packages/health-commons/generated/recent-changes.json`
- `pnpm test:smoke`
- `git diff --check`
- Expected outcomes:
- The supplied patch lands cleanly or is minimally ported with equivalent behavior/content.
- The affected Health Commons content, generated artifacts, and biomarker page behavior are current and scoped.
- The touched UI/content surfaces pass the truthful verification lane.
- Any remaining failed check, if present, is attributable to a precise unrelated blocker rather than this diff.

## Outcomes

- Passed: `pnpm --dir packages/health-commons generate`
- Passed: `pnpm --dir packages/health-commons generate:check`
- Passed: `pnpm --dir packages/health-commons verify`
- Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/health-commons-biomarker-detail-page.test.ts apps/web/test/health-commons-biomarker-page-client.test.ts`
- Passed: `pnpm --dir apps/web typecheck`
- Passed: `pnpm test:smoke`
- Passed: `git diff --check`
- Scoped lane completed: `bash scripts/workspace-verify.sh test:diff ...` ran the `packages/health-commons` checks plus `apps/web verify`, but the wrapper still reports unrelated workspace-boundary violations in `apps/cloudflare/test/hosted-local-linq-cold-start-repro.e2e.test.ts`.
- Unrelated blocker remains: `pnpm typecheck` fails outside this lane on the same `apps/cloudflare/test/hosted-local-linq-cold-start-repro.e2e.test.ts` boundary violations and module-resolution failures under `packages/vault-usecases`.
- Mandatory completion audits completed: `coverage-write`, `frontend-review`, and a rerun `task-finish-review`; the rerun found no remaining material issues in the scoped follow-up diff.

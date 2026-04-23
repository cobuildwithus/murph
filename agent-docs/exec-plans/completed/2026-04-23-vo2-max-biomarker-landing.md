# VO2 max biomarker landing

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Land the supplied VO2 max biomarker patch so the public biomarker page, supporting Health Commons sources, biomarker evidence rendering, and wearable/browser query wiring all integrate cleanly on current `HEAD`.

## Success criteria

- The VO2 max biomarker markdown page and supporting source artifacts are present under `packages/health-commons/content/**`.
- The biomarker detail model and biomarker page render source-backed claims as an Evidence section without regressing existing biomarker behavior.
- Wearable/browser query wiring resolves the intended VO2 max or cardio-fitness estimates through the existing `biomarker:estimated-vo2max` key and related private metric binding.
- Directly required generated Health Commons artifacts are current and scoped to the landed content.
- Scoped verification and mandatory audit passes complete, or any unrelated blocker is named precisely.
- A scoped commit contains only the task-owned files plus plan and ledger closeout.

## Scope

- In scope: the supplied VO2 max biomarker/source content files, the 2026-04 Health Commons change record entry, directly required generated Health Commons artifacts, the biomarker evidence rendering/data-model changes in `apps/web`, the Norwegian 4x4 wording adjustment directly coupled to the new biomarker naming, the wearable/query/importer/browser-replica VO2 max wiring, and plan/ledger bookkeeping.
- Out of scope: unrelated biomarker/content refreshes, other active Health Commons landings, broader biomarker-page redesign, additional protocol-copy sweeps beyond the directly coupled Norwegian 4x4 text, and unrelated dirty-tree work elsewhere in the repo.

## Constraints

- Technical constraints: preserve existing Health Commons schema/frontmatter conventions, keep the public key and route on `biomarker:estimated-vo2max` / `/biomarkers/estimated-vo2max`, treat the supplied patch as intent rather than overwrite authority, and avoid widening wearable/query changes beyond the same-device cardio-fitness projection seam.
- Product/process constraints: preserve unrelated dirty-tree edits, do not expose direct personal identifiers in repo files or commit metadata, keep the `changes/2026-04.jsonl` edit narrowly additive, and use the repo plan/ledger plus scoped commit workflow.

## Risks and mitigations

1. Risk: the supplied patch may not apply cleanly because `packages/health-commons/content/changes/2026-04.jsonl`, generated Health Commons artifacts, and biomarker-page UI files overlap other active rows.
   Mitigation: dry-run the patch first, then port only the minimal conflicting hunks and inspect generated diffs carefully before staging.
2. Risk: regenerated Health Commons artifacts may pick up overlapping active biomarker churn that is not safely attributable to this task.
   Mitigation: compare regenerated outputs against the task-owned content changes and stop if shared generated overlap cannot be scoped confidently.
3. Risk: verification may surface unrelated pre-existing failures from the already-dirty tree.
   Mitigation: prefer the truthful scoped verification lane, record exact failing commands and targets, and confirm whether each failure is attributable to this diff before handoff.

## Tasks

1. Register the task in the coordination ledger and inspect the supplied patch against current `HEAD`.
2. Apply or minimally port the VO2 max biomarker patch without widening scope.
3. Regenerate only the directly required Health Commons artifacts and inspect overlap carefully.
4. Run the required scoped verification and direct proof for the touched app/package/content surfaces.
5. Run the mandatory completion audits for this standard repo change, address findings, and create a scoped commit.

## Decisions

- Use a dedicated active plan because this supplied patch spans multiple authored content files plus `apps/web`, `packages/importers`, and `packages/query` code in a dirty tree.
- Preserve the existing biomarker key and route while upgrading the user-facing copy to VO2 max / cardio-fitness language.
- Treat the Evidence section as a data-driven extension of the current biomarker page, not a broader UI redesign.
- Bundle the overlapping VO2 and SpO2 authored Health Commons content/generated slice into one scoped landing once shared generation is green, but keep the separate percent-threshold app follow-up in `agent-docs/exec-plans/active/2026-04-23-spo2-review-improvements.md`.

## Verification

- Commands to run:
- `git apply --check <supplied-patch>`
- `git apply <supplied-patch>` or equivalent minimal manual port
- `pnpm --filter @murphai/health-commons generate`
- `pnpm --filter @murphai/health-commons generate:check`
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/web/app/biomarkers/[biomarkerId]/biomarker-page-client.tsx apps/web/src/lib/health-commons/biomarker-detail.ts apps/web/src/lib/health-commons/experiment-detail.ts packages/health-commons/content/biomarkers/estimated-vo2max.md packages/health-commons/content/changes/2026-04.jsonl packages/health-commons/content/sources/vo2-max packages/health-commons/generated/catalog.hash packages/health-commons/generated/catalog.json packages/health-commons/generated/entities.ndjson packages/health-commons/generated/recent-changes.json packages/importers/src/device-providers/metric-catalog.ts packages/query/src/browser-replica.ts packages/query/src/wearables/candidates.ts packages/query/src/wearables/types.ts packages/query/src/wearables.ts`
- `pnpm test:smoke`
- `git diff --check`
- Expected outcomes:
- The supplied patch lands cleanly or is minimally ported with equivalent behavior/content.
- The affected Health Commons content, generated artifacts, and query/app wiring are current and scoped.
- The touched UI/query/importer surfaces pass the truthful verification lane.
- Any remaining failed check, if present, is attributable to a precise unrelated blocker rather than this diff.

## Verification notes

- Bundled the shared Health Commons landing slice required to truthfully publish the VO2 page: `estimated-vo2max` content and sources, the overlapping SpO2 authored content/sources, `content/changes/2026-04.jsonl`, redirects, and the directly required generated catalog outputs.
- Kept the `apps/web` landing scope to the route/model/test seam that belongs to this bundle: `app/biomarkers/[biomarkerId]/page.tsx`, `src/lib/health-commons/experiment-detail.ts`, `test/health-commons-biomarker-detail-page.test.ts`, and `test/experiment-detail-protocol-tab.test.ts`. The overlapping percent-threshold copy follow-up in `biomarker-page-client.tsx` remains tracked separately in `agent-docs/exec-plans/active/2026-04-23-spo2-review-improvements.md`.
- Scoped verification passed with:
  - `pnpm --dir packages/health-commons generate`
  - `pnpm --dir packages/health-commons verify`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/health-commons-biomarker-detail-page.test.ts apps/web/test/experiment-detail-protocol-tab.test.ts`
  - `pnpm --dir apps/web typecheck`
  - `pnpm test:smoke`
  - `git diff --check -- apps/web/app/biomarkers/[biomarkerId]/page.tsx apps/web/src/lib/health-commons/experiment-detail.ts apps/web/test/health-commons-biomarker-detail-page.test.ts apps/web/test/experiment-detail-protocol-tab.test.ts packages/health-commons/content/biomarkers/estimated-vo2max.md packages/health-commons/content/biomarkers/blood-oxygen-spo2.md packages/health-commons/content/changes/2026-04.jsonl packages/health-commons/content/redirects.json packages/health-commons/content/sources/spo2 packages/health-commons/content/sources/vo2-max packages/health-commons/generated/catalog.hash packages/health-commons/generated/catalog.json packages/health-commons/generated/entities.ndjson packages/health-commons/generated/recent-changes.json packages/health-commons/generated/redirects.json`
- Earlier direct VO2 query/importer verification stayed green while the follow-on regression fixes were in the shared tree:
  - `pnpm --dir packages/query test:coverage`
  - `pnpm --dir packages/importers test:coverage`
- Broader repo wrappers remain red for unrelated dirty-tree work and were not used as the commit gate:
  - `pnpm typecheck` fails in `apps/cloudflare` on pre-existing workspace-boundary and `HostedRuntimeEvent[]` typing issues.
  - `bash scripts/workspace-verify.sh test:diff ...` fails on the same `apps/cloudflare` issues plus unrelated `packages/assistant-engine` test failures.
Completed: 2026-04-23

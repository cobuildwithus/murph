# Red-light findings wake

Status: completed
Created: 2026-04-21
Updated: 2026-04-21

## Goal

- Land the downloaded `red-light-glasses-findings.patch` intent on top of the current red-light source corpus without overwriting overlapping in-flight Health Commons generated work.
- Keep the change scoped to the returned `**Findings:**` paragraphs for the cited red-light research sources plus the directly coupled generated Health Commons artifacts.

## Success criteria

- The 23 red-light research source pages targeted by the downloaded patch gain concise `**Findings:**` paragraphs in the existing page-body flow.
- The bibliography/curation page and corpus JSON remain untouched by this task.
- `packages/health-commons/generated/{catalog.hash,catalog.json,entities.ndjson}` are refreshed from the current workspace state instead of forcing stale patch hunks.
- Scoped verification for the touched Health Commons slice is recorded, and any unrelated blockers are called out precisely.
- A scoped commit includes only this task's files plus plan/ledger closeout if the overlapping generated files are safe to commit.

## Scope

- In scope: the 23 source-artifact Markdown pages named by the downloaded patch, directly coupled generated Health Commons artifacts, and the plan/ledger entries for this task.
- Out of scope: the red-light bibliography page, other Health Commons source families, hosted-web experiment-detail changes, and unrelated sauna, Norwegian, or verification-tooling work.

## Constraints

- Treat the downloaded patch as behavioral intent, not overwrite authority.
- Preserve overlapping dirty-tree edits and avoid touching unrelated active rows.
- Keep the wording concise and faithful to the patch's article-level findings summaries.
- Generated-file refresh must preserve other active Health Commons work already present in the dirty tree.
- Do not expose personal identifiers in docs, commits, or handoff.

## Tasks

1. [ ] Register the task in the coordination ledger and keep the scope isolated from the other active Health Commons rows.
2. [ ] Add the downloaded `**Findings:**` paragraphs to the 23 cited red-light research source pages.
3. [ ] Refresh the directly coupled Health Commons generated artifacts from the current workspace state and confirm the incremental diff stays limited to the red-light content change.
4. [ ] Run the required scoped verification for `packages/health-commons`, complete the required audit path, and create a scoped commit if file overlap permits it safely.

## Verification

- Passed: `pnpm typecheck`
- Failed for unrelated pre-existing reason: `bash scripts/workspace-verify.sh test:diff packages/health-commons/content/sources/red-light-glasses-before-bed/doi-10.17617-1.4a6s-ec74.md packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-15713707.md packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-20030543.md packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-26414986.md packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-27226262.md packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-27322730.md packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-29101797.md packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-29991437.md packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-30427265.md packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-33587901.md packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-33707105.md packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-34030534.md packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-35024497.md packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-35089982.md packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-35298459.md packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-36051910.md packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-37192881.md packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-37593770.md packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-40728371.md packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-41166315.md packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-41341515.md packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-41421618.md packages/health-commons/content/sources/red-light-glasses-before-bed/pmid-41565717.md packages/health-commons/generated/catalog.hash packages/health-commons/generated/catalog.json packages/health-commons/generated/entities.ndjson` because `apps/web/test/experiment-header.test.ts` still expects stale Bryan Johnson Sauna baseline/protocol copy that predates this red-light slice.
- Passed: `pnpm test:smoke`
- Passed: `git diff --check`

## Title

Land the supplied Health Commons sauna docs cleanup patch.

## Goal

Apply the externally prepared Health Commons sauna cleanup patch, verify the generated Health Commons artifacts and focused tests still hold, and commit only the scoped docs/contracts/health-commons changes.

## Scope

- `.gitignore`
- `agent-docs/product-specs/health-commons.md`
- `packages/contracts/src/health-commons.ts`
- `packages/health-commons/**`

## Constraints

- Treat the supplied patch as bounded intent, not a pretext for unrelated cleanup.
- Preserve unrelated dirty-tree edits and overlapping active lanes elsewhere in the repo.
- Keep generated Health Commons outputs aligned with the source changes landed by the patch.
- Run the strongest truthful scoped verification available for this slice, plus `pnpm typecheck` unless blocked.

## Verification

- planned: `git apply --check --verbose <provided patch>`
- planned: `pnpm typecheck`
- planned: `bash scripts/workspace-verify.sh test:diff packages/contracts/src/health-commons.ts packages/health-commons/src/hash-artifact.ts packages/health-commons/src/load.ts packages/health-commons/src/sync-cloudflare-r2.ts packages/health-commons/test/load.test.ts`
- planned: `git diff --check`

## Notes

- The main behavioral fix is to include `source_artifact` page-frontmatter `artifacts[]` in the generated artifact-manifest set so Cloudflare/R2 sync consumes both manifest JSON files and page-declared source artifacts.
- The supplied patch also updates Health Commons schema typing, artifact id normalization, sauna protocol docs, generated catalog outputs, and a focused load test.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20

# Health Commons Clean Biomarker Projections

## Goal

Land the supplied Health Commons clean-projections patch so public biomarker routes consume generated page-shaped artifacts instead of route-bundle catalog reads.

Success criteria:

- Generated biomarker `shell`, `overview`, and `research` artifacts are produced by `packages/health-commons`.
- `/biomarkers` browse data includes `shortName` without loading every biomarker bundle at request time.
- Public biomarker layout, overview, and research routes load only their matching generated artifact shape.
- Route-bundle boundary tests cover biomarker routes.
- Required Health Commons/app verification and completion-review steps are run or explicitly reported if blocked by unrelated dirty-tree failures.

## Scope

- `packages/health-commons/src/**`
- `apps/web/src/lib/health-commons/**`
- `apps/web/app/biomarkers/**`
- `apps/web/src/components/biomarkers/**`
- Directly coupled hosted-web tests

## Constraints

- Preserve unrelated active browser-vault and hosted/web/runtime work in the current checkout.
- Treat the supplied patch as behavioral intent, not overwrite authority.
- Do not commit generated Health Commons output unless the repository policy or task-specific patch requires it; generated catalog artifacts are ignored build output by default.
- Do not write local usernames, home paths, or direct personal identifiers into repo files, generated files, comments, logs, or commits.

## Verification Plan

- `pnpm --dir packages/health-commons generate`
- `pnpm --dir packages/health-commons generate:check`
- `pnpm typecheck`
- `pnpm --dir apps/web test -- health-commons-route-bundle-boundary`
- Additional scoped checks if generated/app reconciliation changes direct behavior.

## State

- Patch inspected. Most hunks are clean, but several biomarker component hunks need manual reconciliation against current files.

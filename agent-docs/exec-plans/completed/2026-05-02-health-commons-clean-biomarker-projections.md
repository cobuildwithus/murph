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

- Patch landed in the current checkout with manual reconciliation for stale biomarker component and projection hunks.
- Health Commons generation and generate-check passed.
- Root typecheck passed after aligning biomarker tests with shell/overview projection shapes and fixing a browser-vault test narrowing issue.
- Focused biomarker detail page and route-bundle boundary tests passed through direct Vitest file filters.
- A broad accidental hosted-web Vitest workspace run remains red on unrelated active hosted/device-sync/experiment expectation lanes.
- Final incremental cleanup applied manually because the downloaded patch file was malformed at its final hunk header; intended hunks were complete and recovered.
- Biomarker protocol rankings now project protocol image paths from protocol media, and card/hero/row components consume the projected `protocol.image` instead of loading experiment shells per card.
- Route-index biomarker projection paths are canonical for published biomarker routes; app biomarker artifact loading returns `null` when a route lacks a declared projection path.
- Requested generation/check/typecheck commands passed after the final cleanup. The requested hosted-web test command still ran the full app Vitest workspace and failed on unrelated active hosted/onboarding/device-sync/content lanes; the direct route-bundle boundary file passed.
- Direct artifact readback confirmed top VO2 max protocol rankings include projected image paths.
- Security/privacy review passed with no findings.
- Frontend review passed with no findings; no browser screenshot was taken because markup/classes were unchanged.
- Final review found an optional-`mediaType` edge case in biomarker image projection; fixed by accepting valid media entries with missing `mediaType`, matching the shared `StoredMedia` schema.
- Post-fix `generate`, `generate:check`, root `typecheck`, direct route-bundle boundary test, touched-file hosted-web lint, direct artifact readback, and diff-check passed.
- Post-fix requested hosted-web test command remains red on unrelated full-workspace hosted-web tests outside this Health Commons lane.

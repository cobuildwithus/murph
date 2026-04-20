## Title

Land the supplied Health Commons dry-sauna taxonomy and source-pack patch.

## Goal

Apply the still-relevant changes from the watched ChatGPT patch for `packages/health-commons` and the matching product spec: move the first sauna seed content to user-facing `dry-sauna` family/protocol keys, add the cited source and biomarker seed pages, expand the research artifact manifest stubs, and regenerate the derived catalog artifacts without touching unrelated hosted-run work.

## Scope

- `agent-docs/product-specs/health-commons.md`
- `packages/health-commons/content/**`
- `packages/health-commons/generated/**`
- `packages/health-commons/test/**`
- verification, audit, and commit artifacts required by repo policy for this slice

## Constraints

- Keep changes scoped to the downloaded patch intent; do not broaden into unrelated Health Commons schema or loader logic unless needed to make the supplied content validate.
- Preserve all unrelated dirty-tree edits outside the touched Health Commons/spec files.
- Prefer regenerated `packages/health-commons/generated/**` artifacts over hand-edited snapshots when the current generator already produces the required output.
- Treat the stale patch as behavioral intent, not overwrite authority, where current files have drifted.

## Verification

- planned: `pnpm typecheck`
- planned: `bash scripts/workspace-verify.sh test:diff agent-docs/product-specs/health-commons.md packages/health-commons`
- planned: `pnpm --filter @murphai/health-commons verify`
- planned: `git diff --check -- agent-docs/product-specs/health-commons.md packages/health-commons`

## Notes

- The downloaded patch does not apply verbatim because current source/generated files already diverged; land the patch manually and regenerate deterministic artifacts from the package's existing build path.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20

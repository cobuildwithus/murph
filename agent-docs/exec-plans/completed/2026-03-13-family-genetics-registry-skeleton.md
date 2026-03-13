# Family Genetics Registry Skeleton

## Goal

Remove the duplicated family/genetics markdown-registry upsert control-flow skeleton with a small shared helper, while preserving current record ids, slugs, relative paths, markdown output, and audit behavior.

## Scope

- Add a small helper under `packages/core/src/registry/markdown.ts` for resolving existing-vs-new registry write targets and executing the shared markdown write/audit path.
- Refactor `packages/core/src/family/api.ts` and `packages/core/src/genetics/api.ts` to use that helper.
- Keep domain-specific body rendering, attribute assembly, normalization, enum handling, alias handling, and sort order local.
- Add or adjust focused tests only if needed to preserve current behavior.

## Constraints

- No changes to markdown frontmatter/body shape.
- No changes to id/slug derivation or update-path stability.
- No changes to audit action, command name, summary text, or operation type.
- Avoid broad abstraction beyond the family/genetics shared shell.

## Verification

- `pnpm --dir packages/core test`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

Status: completed
Updated: 2026-03-13
Completed: 2026-03-13
Completed: 2026-03-13

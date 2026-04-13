## Goal

Land the supplied CLI and query cleanup patch, verify the touched package behavior truthfully, and commit only the scoped task files without disturbing unrelated worktree edits.

## Constraints

- Preserve unrelated edits already present in the worktree.
- Treat the supplied patch as intent, not overwrite authority.
- Run required verification for touched package owners unless blocked by an unrelated environment failure.
- Use the repo completion workflow, including required audit passes.

## Scope

- Apply the launcher-name preservation changes for the published CLI entrypoints.
- Keep the package-shape guard against reintroducing `runner-vault-cli*` compatibility files.
- Remove the dead query metadata alias and keep the narrowed surface covered by tests.

## Verification Plan

- Prefer `bash scripts/workspace-verify.sh test:diff <touched paths...>` for truthful scoped verification on the touched owners.
- Run additional targeted package commands only if the diff-aware lane proves insufficient.

## Outcome

- Implemented the supplied CLI launcher-name preservation path, package-shape guard, and query metadata surface trim.
- Updated existing CLI/query tests where they still asserted the old launcher or alias surface.

## Verification Outcome

- `pnpm --dir packages/query typecheck` passed.
- `pnpm --dir packages/query test:coverage` passed.
- `pnpm test:smoke` passed.
- `pnpm --dir packages/cli verify:coverage` passed.
- Focused CLI source tests covering the launcher surface passed.
- Direct scenario proof confirmed `createVaultCliShell('murph').name === 'murph'` and `createVaultCliShell('vault-cli').name === 'vault-cli'`.

## Notes

- Existing unrelated edits are already present in `apps/web/**`, `package.json`, and `pnpm-lock.yaml`.
Status: completed
Updated: 2026-04-13
Completed: 2026-04-13

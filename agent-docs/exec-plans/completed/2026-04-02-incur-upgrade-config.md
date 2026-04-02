# Repo Green And Workspace Commit Plan

## Goal

Land the incur upgrade/config work, get the current dirty workspace back to green required checks, and commit the remaining workspace files per the user's explicit instruction.

## Scope

- Update the `incur` pins in `packages/cli`, `packages/assistant-core`, and `packages/gateway-core`, then refresh the committed lockfile.
- Keep the root `vault-cli` topology intact while enabling incur's built-in config-file support for repeatable option defaults.
- Add focused CLI tests and lightweight package docs for the new config surface.
- Include the remaining dirty generated/runtime-tracked files already present in the workspace when they are part of the green verification outcome.
- Resolve the current hosted-web smoke-lock blocker and any other minimal repo-green issues required for the full baseline.

## Constraints

- Target npm's `latest` dist-tag rather than unpublished or non-default prerelease lines unless verification proves otherwise.
- Preserve existing nested incur router groups, generated command topology, and current command semantics.
- Keep the feature work framework-native; do not add a Murph-specific config parser.
- The user explicitly asked to commit the remaining dirty workspace files once checks are green.

## Verification

- `pnpm deps:guard`
- `pnpm deps:ignored-builds`
- `pnpm typecheck`
- `pnpm verify:cli`
- `pnpm test`
- `pnpm test:coverage`
- Direct scenario proof with the built CLI using `--config <path>`
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02

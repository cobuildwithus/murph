# Release Publish Npm Update Removal

## Goal

Remove the failing npm self-update from the tag-driven publish workflow so GitHub Actions can reach the actual tarball publish step using the runner's stock npm.

## Scope

- Delete the `npm install -g npm@latest` publish bootstrap step.
- Add focused guard coverage that the workflow no longer requires that self-update.

## Constraints

- Keep the change narrow to the publish workflow bootstrap path.
- Preserve the `NPM_TOKEN` fallback and trusted-publishing fallback behavior.
- Do not broaden into unrelated release-script or package-version logic.

## Verification

- `pnpm exec vitest run packages/cli/test/release-workflow-guards.test.ts --no-coverage`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Status

- In progress
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04

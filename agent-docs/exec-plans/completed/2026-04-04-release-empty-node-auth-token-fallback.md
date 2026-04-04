# Release Empty Node Auth Token Fallback

## Goal

Make the tag-driven npm publish workflow succeed when `NPM_TOKEN` is unset by ensuring the trusted-publishing fallback runs without an empty `NODE_AUTH_TOKEN` value.

## Scope

- Keep the release workflow's `NPM_TOKEN` fast path.
- Explicitly clear `NODE_AUTH_TOKEN` in the trusted-publishing fallback branch.
- Add focused workflow guard coverage for that fallback behavior.

## Constraints

- Keep the change narrow to the publish job auth handoff.
- Preserve the existing tag validation, pack ordering, and publish helper flow.
- Do not disturb unrelated dirty-tree edits already present in the repo.

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

# Release Publish Auth Fix

## Goal

Fix the tag-driven release workflow so a monorepo release can publish the full package set to npm instead of failing after the first package when package-level trusted publishing is incomplete.

## Scope

- Restore an `NPM_TOKEN` fallback in `.github/workflows/release.yml` for the publish step.
- Update the focused release workflow guard test to assert the intended auth behavior.
- Update durable verification docs to describe the live publish auth expectation.

## Constraints

- Keep the change narrow to release publication auth and docs/tests that describe it.
- Preserve the existing trusted-publishing path when `NPM_TOKEN` is absent.
- Do not broaden into unrelated package-version or release-script changes.

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

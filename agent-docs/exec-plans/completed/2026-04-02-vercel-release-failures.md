# Vercel And Release Failure Follow-Up

## Goal

Fix the current hosted-web Vercel deployment failure and the release publish workflow failure triggered by `v0.1.4`.

## Scope

- Restore hosted-web workspace source resolution for any package now required transitively by `@murphai/inboxd` after the parser-boundary cleanup.
- Adjust release publishing so the workflow can authenticate with npm in environments where trusted publishing for the `@murphai` scope is not available or not yet configured.
- Add or update focused proof for the touched config and workflow behavior.

## Constraints

- Preserve unrelated dirty worktree edits, especially `agent-docs/generated/doc-inventory.md`.
- Keep the fix narrow to deploy/release behavior; do not reopen the parser/gateway refactor itself.
- Prefer a repo-side fix that addresses the observed failures directly rather than papering over them with broader config changes.

## Verification

- Focused hosted-web config proof
- Focused release workflow/script proof
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Outcome

- Completed. Hosted-web now source-resolves `@murphai/parsers` after the inboxd boundary cleanup, and the publish workflow now supports an `NPM_TOKEN` fallback while surfacing a clearer npm scope-permission failure.
Status: completed
Updated: 2026-04-02

## Final Verification

- `pnpm exec vitest run apps/web/test/next-config.test.ts packages/cli/test/release-workflow-guards.test.ts --no-coverage`
- `pnpm --dir apps/web typecheck`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
Completed: 2026-04-02

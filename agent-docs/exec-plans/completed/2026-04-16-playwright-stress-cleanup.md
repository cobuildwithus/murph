# Playwright Stress Cleanup

## Goal

Remove the temporary local Playwright stress helper and dependency now that production pooled-connection verification is complete.

## Scope

- Delete `apps/web/scripts/hosted-playwright-stress.ts`
- Remove the `stress:playwright` script from `apps/web/package.json`
- Remove the root `@playwright/test` devDependency and update `pnpm-lock.yaml`
- Delete temporary local Playwright session/profile files created during testing

## Constraints

- Do not touch production env configuration or application runtime behavior.
- Do not disturb unrelated active worktree edits.
- Keep this cleanup limited to the temporary testing tooling added for the pool investigation.

## Verification

- `pnpm typecheck`
- `pnpm test:diff apps/web package.json pnpm-lock.yaml`

## Notes

- Treat this as low-risk tooling cleanup and keep review local unless the diff unexpectedly grows.
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16

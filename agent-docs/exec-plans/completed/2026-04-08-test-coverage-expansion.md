# Test Coverage Expansion

## Goal

Expand the root `pnpm test:coverage` package lane so it exercises materially more critical package tests by default, especially the assistant/runtime/device-sync/hosted execution stack and the full CLI bucket set.

## Why

- The current root package coverage workspace is intentionally curated and leaves out several important package-local tests.
- Repo acceptance should cover more of the critical package stack before it relies on app-only verification or external/manual gaps.

## Scope

- `vitest.config.ts`
- Verification docs that describe `pnpm test:packages`, `pnpm test:packages:coverage`, and `pnpm test:coverage`
- Coordination artifacts for this task

## Constraints

- Keep `apps/web` and `apps/cloudflare` in their dedicated app verify lanes; do not duplicate them in the root package coverage workspace.
- Preserve the existing CLI bucket structure and repo parallelism controls.
- Favor folding in full package-local Vitest surfaces for packages that already own repo-local Vitest configs instead of inventing a second custom curation scheme.

## Verification

- `pnpm typecheck`
- `pnpm test:packages:coverage`

## Notes

- If the wider lane proves too slow or flaky, document the tradeoff explicitly instead of leaving the narrower curated set implied by stale docs.
Status: completed
Updated: 2026-04-08
Completed: 2026-04-08

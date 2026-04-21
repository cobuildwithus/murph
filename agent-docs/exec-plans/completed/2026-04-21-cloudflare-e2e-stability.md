## Title

Stabilize hosted-local Cloudflare e2e tests so the full local bundle passes with correct mocks and setup.

## Goal

Make the hosted-local Cloudflare e2e suite pass reliably by fixing broken test expectations, mock wiring, and harness setup without broadening the runtime surface.

## Scope

- `apps/cloudflare/test/**`
- `apps/cloudflare/scripts/run-hosted-local-e2e.ts`
- `apps/cloudflare/vitest.e2e.config.ts`
- directly coupled shared helpers or fixtures used only by the hosted-local e2e lane

## Constraints

- Keep production behavior unchanged unless a test failure proves the harness depends on an invalid runtime contract.
- Prefer fixing mocks, fixtures, and local test setup over weakening runtime invariants.
- Preserve unrelated dirty-tree edits, especially existing work in `apps/web/next-env.d.ts` and `scripts/research.sh`.
- Keep the change narrow to the hosted-local Cloudflare e2e lane and its direct dependencies.

## Verification

- targeted hosted-local e2e commands under `apps/cloudflare`
- `pnpm typecheck`
- `pnpm verify:acceptance`

## Notes

- The user explicitly wants the e2e suite to pass fully and be mocked/setup correctly, so the failure mode matters as much as the green result.
- If the suite depends on unstable external services, the fix should push that dependency behind repo-owned mocks or deterministic local harness setup.
Status: completed
Updated: 2026-04-21
Completed: 2026-04-21

# PR 824 runner boot-closure repair

Status: completed
Created: 2026-07-21
Updated: 2026-07-21

## Goal

- Restore PR 824's hosted runner bundle gate without moving the clinical-records
  runtime graph into the runner's static boot closure.

## Root cause

- `@murphai/hosted-execution/clinical-records-boundary` imports the retrieval
  slice limit from the broad `@murphai/clinical-records` root entrypoint.
- Cloudflare imports that boundary during runner boot, so the production bundle
  includes `clinical-records/dist/index.js`, which the static-closure guard
  rejects before hosted E2E can start.

## Scope

- Add one narrow public clinical-records limits entrypoint.
- Point the static hosted-execution boundary at that entrypoint while preserving
  the root export for existing consumers.
- Keep TypeScript and Vitest source-resolution maps explicit for the public leaf.
- Keep the broad clinical-records package forbidden from runner boot and prove
  the narrow limits leaf is allowed.
- Ratchet the fixed total bundle ceiling by the exact measured overage from the
  intended lazy Epic query/admission code; leave entry and static-closure caps
  unchanged.

## Verification

- `pnpm --dir packages/clinical-records typecheck`
- `pnpm --dir packages/hosted-execution typecheck`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-bundle-entrypoint-bundle.test.ts --no-coverage` (30 tests on the final allowlist)
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/workspace-source-resolution.test.ts --no-coverage` (7 tests)
- `pnpm --dir apps/cloudflare runner:bundle:hosted-local` (exact failed CI command, rerun after final allowlist; total 9,327,862B, entry 1,556,156B, static closure 7,686,577B)
- `git diff --check`
- `pnpm test:diff` passed all repo tools, 18 affected typechecks, package tests,
  hosted package-boundary proof, and Web verification. Its final Cloudflare lane
  found the budget-policy test still asserted the pre-ratchet total; update and
  complete that exact lane below.
- `pnpm --dir apps/cloudflare verify` (1,845 Node tests, 1 Workers test)
Completed: 2026-07-21

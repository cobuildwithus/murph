# 2026-03-31 Test Suite Concurrency

## Goal

Make repo-owned Vitest suites opt into in-file concurrency consistently instead of limiting that behavior to selected CLI files, while preserving the existing environment override knobs and keeping the durable docs truthful.

## Scope

- `config/vitest-parallelism.ts`
- `vitest.config.ts`
- `packages/*/vitest.config.ts`
- `packages/cli/vitest.config.ts`
- `packages/cli/vitest.workspace.ts`
- `packages/web/vitest.config.ts`
- `apps/web/vitest.config.ts`
- `apps/web/vitest.workspace.ts`
- `apps/cloudflare/vitest.config.ts`
- `apps/cloudflare/vitest.node.workspace.ts`
- `apps/cloudflare/vitest.workers.config.ts`
- `packages/web/package.json`
- `packages/web/scripts/verify-fast.sh`
- `apps/web/package.json`
- `apps/web/scripts/verify-fast.sh`
- `apps/cloudflare/package.json`
- `apps/cloudflare/scripts/verify-fast.sh`
- `apps/cloudflare/test/workers/wrangler.vitest.jsonc`
- `scripts/workspace-verify.sh`
- `agent-docs/index.md`
- `agent-docs/operations/verification-and-runtime.md`
- `agent-docs/references/testing-ci-map.md`

## Risks

- latent order dependence or shared-state coupling inside existing test files
- root multi-project config accidentally overriding per-project concurrency settings
- parallel verify wrappers masking step failures or overstating docs
- doc drift around defaults and env overrides

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Status

In progress during repo-wide Vitest concurrency expansion and verification in this turn.
Status: completed
Updated: 2026-03-31
Completed: 2026-03-31

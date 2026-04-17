## Goal

Land the supplied browser-vault hard-cut patch as a scoped cross-owner change that keeps hosted canonical truth in `apps/web`, keeps execution coordination plus opaque encrypted blobs in `apps/cloudflare`, and serves a browser-local encrypted snapshot/query path without adding a browser sqlite layer or hosted Postgres vault mirror.

## Scope

- `apps/cloudflare/src/**` browser-vault snapshot storage, routing, and finalize-time export wiring
- `apps/web/app/(dashboard)/**` browser-vault-backed dashboard pages
- `apps/web/app/api/browser-vault/session/route.ts`
- `apps/web/src/lib/browser-vault/**`
- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/cloudflare-hosted-control/src/**`
- `packages/query/src/**` browser-safe read-model split
- `packages/runtime-state/src/**` hosted-storage encryption seam
- touched package manifests needed for the new public/browser entrypoints

## Constraints

- Preserve unrelated dirty worktree edits.
- Treat the supplied patch as the intended behavior cut unless repo-state drift forces a minimal local adjustment.
- Keep canonical product/control facts in `apps/web`; do not move them into hosted runtime or browser-local persistence.
- Keep browser access read-only and derived from the encrypted latest snapshot plus stateless session re-wrap flow.
- Avoid exposing secrets or personal identifiers in logs, docs, code, commits, or handoff.

## Verification

- Required repo verification for this high-risk cross-cutting change:
  - `pnpm typecheck`
  - `pnpm verify:acceptance` unless a truthful diff-aware lane clearly covers the touched app/package slice
- Direct scenario proof for the new browser-vault session/snapshot path where feasible in the local environment
- Required completion audits per repo policy before handoff

## Current results

- `pnpm typecheck`: passed before later unrelated concurrent work expanded elsewhere in the dirty tree.
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm --dir apps/web lint`: passed with warnings only, no errors.
- `pnpm --dir packages/query test`: passed.
- `pnpm --dir packages/assistant-runtime test:coverage`: passed.
- `pnpm --dir packages/cloudflare-hosted-control test:coverage`: passed.
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/browser-vault-session-route.test.ts --no-coverage`: passed.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --project cloudflare-node-platform test/browser-vault-store.test.ts --no-coverage`: passed.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --project cloudflare-node-platform test/crypto.test.ts --no-coverage`: passed.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --project cloudflare-node-runner test/user-runner.test.ts --no-coverage`: passed.
- Broader dirty-tree verification lanes remain blocked by credibly unrelated concurrent work already present in this clone:
  - `pnpm --dir apps/cloudflare verify` fails in reverse-dependent runner tests on missing `@murphai/vault-usecases/assistant-vault-paths` resolution outside this slice.
  - `pnpm --dir apps/web test` fails on hosted-wake migration assertions outside this slice.
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17

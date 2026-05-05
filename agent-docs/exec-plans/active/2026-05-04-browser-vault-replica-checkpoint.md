# Browser Vault Replica Checkpoint

## Goal

Publish an encrypted browser-vault replica on every hosted workspace snapshot checkpoint, store the returned ref in the hosted workspace row, and reject future snapshot advances that do not carry a matching browser-vault replica ref.

## Scope

- Add a narrow hosted runtime platform port for browser-vault replica writes.
- Implement the Cloudflare adapter through the existing internal runner outbound trust boundary.
- Build the replica from the restored local vault during snapshot creation.
- Preserve explicit `browserVaultReplicaRef: null` in checkpoint builders and add a web-side mismatch guard.
- Add focused tests for the publication path, internal route, request builder, and checkpoint invariant.

## Constraints

- Do not expose private vault contents, user identifiers, object keys, or raw crypto material in logs or docs.
- Keep R2 write/encryption authority in Cloudflare Worker code; the runner only sends the replica over the existing authenticated internal channel.
- Preserve unrelated active hosted runtime and onboarding work in the dirty worktree.

## Verification

Completed:

- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-workspace-runner.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runtime-bridge-workspace.test.ts apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/runner-outbound.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-workspace-store.test.ts apps/web/test/hosted-runtime-internal-routes.test.ts`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir apps/web typecheck:prepared`

Blocked:

- `pnpm --dir apps/cloudflare typecheck` is blocked by the active hot-state overlay checkpoint lane's existing layered-snapshot test type errors in `apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts` and `apps/cloudflare/test/runtime-bridge-checkpoint.test.ts`.

## State

- 2026-05-04: Implemented. Full hosted checkpoints now publish an encrypted browser-vault replica and persist its ref; hot/layered checkpoints preserve or validate the source snapshot/base ref invariant.

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
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-workspace-store.test.ts apps/web/test/hosted-runtime-internal-routes.test.ts apps/web/test/browser-vault-session-route.test.ts`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir apps/web typecheck:prepared`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm --dir packages/hosted-execution typecheck`
- `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts --no-coverage test/hosted-execution.test.ts test/parsers.test.ts`
- `pnpm typecheck`

Blocked / unrelated:

- `pnpm test:diff` reached the package test lane and failed in `packages/health-commons/test/runtime.test.ts` on the compact generated biomarker browse index. The failure is from unrelated Health Commons content changes already present in the dirty worktree, not from this checkpoint fix.

## State

- 2026-05-04: Implemented. Full hosted checkpoints publish an encrypted browser-vault replica and persist its ref.
- 2026-05-05: Reviewed and scoped-committed as `09381a1c8` (`fix(hosted-runtime): checkpoint browser vault replicas`). Added the missing browser-vault internal runner proxy-token gate before committing.

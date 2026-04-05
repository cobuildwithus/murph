# 2026-04-05 Managed-Hosted Key Surface Lockdown

## Goal

Remove dead hosted key-envelope and user-managed recipient mutation surfaces from the normal managed-hosted control plane while preserving the internal automation/bootstrap behavior the Cloudflare runtime still needs.

## Scope

- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/src/user-key-store.ts`
- `apps/cloudflare/src/worker-contracts.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/test/**` for focused key-surface coverage
- `apps/web/src/lib/hosted-execution/{keys.ts,browser-user-keys.ts}`
- `packages/hosted-execution/src/{client.ts,routes.ts}`
- `packages/hosted-execution/test/hosted-execution.test.ts`
- `ARCHITECTURE.md` only if the documented internal route surface needs to change

## Constraints

- Treat this as a greenfield managed-hosted cutover; do not preserve dead legacy key-management APIs, payloads, or compatibility shims.
- Preserve unrelated dirty-tree edits already present in the shared worktree.
- Keep only internal automation-recipient/bootstrap behavior; do not add user-unlock, passkeys, OIDC, Vault/OpenBao, TEE behavior, or new mode flags.
- `HOSTED_CONTACT_PRIVACY_KEY` remains out of scope and allowed.
- Add focused tests for trust-boundary/storage-policy changes.

## Plan

1. Remove dead shared-client and web wrappers for hosted key-envelope reads/writes and recipient mutation after verifying there are no live callers.
2. Remove the corresponding Cloudflare control routes and Durable Object stub/runner methods so the normal managed-hosted surface no longer exposes envelope replacement or recipient mutation.
3. Simplify the Cloudflare user-key store to the internal automation/bootstrap responsibility that remains.
4. Update focused tests to cover the reduced route surface and delete dead browser/user-key tests.
5. Run required verification, complete the required final audit pass, then finish with a scoped commit.

## Progress

- Done: verified the live tree has no non-test callers for `apps/web/src/lib/hosted-execution/keys.ts` and `browser-user-keys.ts`; bootstrap/runtime reads still flow through internal `ensureUserCryptoContext`.
- Done: removed the normal-surface Cloudflare routes, Durable Object methods, and shared hosted-execution client helpers for hosted key-envelope replacement and recipient mutation.
- Done: kept only the internal automation/bootstrap envelope behavior in the hosted user key store and runner path.
- Done: updated focused tests to keep the deleted routes hard-disabled and to preserve automation bootstrap/rotation coverage.
- Done: ran the required final audit pass with no findings.

## Verification

- `pnpm typecheck` failed for unrelated dirty-tree assistant-core errors in `packages/assistant-core/src/inbox-services/promotions.ts` and dependent callers.
- `pnpm --dir packages/hosted-execution typecheck`
- `pnpm --dir packages/hosted-execution test -- hosted-execution.test.ts`
- `pnpm --dir packages/hosted-execution test -- outbox-payload.test.ts`
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/index.test.ts --no-coverage`
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/user-key-store.test.ts --no-coverage`
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/user-runner.test.ts --no-coverage -t "automation-key rotation|stores encrypted per-user env config|reads per-user env encrypted with a previous key id after rotation|clears per-user env config without dropping unrelated agent-state bundle data"`
- `pnpm --dir ../.. exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-execution-hydration.test.ts apps/web/test/hosted-execution-outbox-payload.test.ts --no-coverage`
- `pnpm --dir apps/cloudflare typecheck` failed on the same unrelated assistant-core dirty-tree errors.
- `pnpm --dir apps/cloudflare test:workers -- apps/cloudflare/test/workers/runtime.test.ts` failed in the sandbox with Wrangler/log/listen `EPERM`.

Status: completed
Updated: 2026-04-05
Completed: 2026-04-05

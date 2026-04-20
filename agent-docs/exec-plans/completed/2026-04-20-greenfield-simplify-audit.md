# Greenfield simplify audit for stale hosted/cloudflare seams

Status: completed
Created: 2026-04-20
Updated: 2026-04-20

## Goal

- Verify six requested simplification candidates against the current workspace and land only the remaining safe reductions so the codebase reflects the narrowest current greenfield shape.

## Success criteria

- Each of the six requested candidates is classified as either already landed in the current workspace, not applicable, or fixed in this turn with direct file evidence.
- Any code changes stay narrowly scoped to dead helpers, stale optional branches, duplicate crypto-context construction, or repeated env-category maps without broadening product/runtime behavior.
- Overlapping dirty-tree work is preserved; this task does not revert or overwrite in-flight edits from other active lanes.

## Scope

- `apps/web/src/lib/device-sync/connect-start-route.ts`
- `apps/cloudflare/src/local-loopback-proxy.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/models.ts`
- directly coupled `packages/assistant-runtime/src/hosted-runtime/{execution,utils,typing}.ts` and focused tests if required
- `apps/cloudflare/src/{bundle-store,runner-secrets,hosted-env-policy,user-key-store,user-runner}.ts`
- `apps/cloudflare/src/{worker-routes/shared,runner-outbound/shared}.ts`
- directly coupled `apps/cloudflare/src/user-runner/{runner-secrets,runner-run-processor}.ts` and focused tests if required

## Constraints

- Treat existing dirty-tree reductions as potentially already landed; confirm before editing.
- Preserve unrelated and overlapping worktree edits, especially the active wake-to-run, runner-drain, and security-followup lanes.
- Keep behavior unchanged unless removing unreachable or unused code paths makes the behavior more explicit.
- Do not broaden secrets authority, hosted-run protocol shape, or env-key membership in this pass.

## Verification

- passed: `git diff --check -- apps/cloudflare/src/user-runner.ts apps/cloudflare/src/hosted-env-policy.ts packages/assistant-runtime/src/hosted-assistant-env.ts packages/assistant-runtime/src/hosted-env-categories.ts packages/assistant-runtime/src/hosted-runtime/utils.ts packages/assistant-runtime/test/hosted-runtime-utils.test.ts packages/assistant-runtime/test/package-entrypoints.test.ts`
- passed: `pnpm --dir apps/cloudflare typecheck`
- passed: `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/hosted-env-policy.test.ts test/runner-run-processor.test.ts test/user-runner-resume-finalize.test.ts --no-coverage`
- passed: `pnpm --dir packages/assistant-runtime test`
- blocked by pre-existing workspace lock: `pnpm typecheck`
- blocked by pre-existing workspace lock, then failed for an unrelated pre-existing reason: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/src/hosted-env-policy.ts packages/assistant-runtime/src/hosted-assistant-env.ts packages/assistant-runtime/src/hosted-env-categories.ts packages/assistant-runtime/src/hosted-runtime/utils.ts packages/assistant-runtime/test/hosted-runtime-utils.test.ts packages/assistant-runtime/test/package-entrypoints.test.ts`
- failed for unrelated pre-existing reason: `pnpm --dir packages/assistant-runtime typecheck` (`config/vitest-package.ts`: `Module '"vitest/config"' has no exported member 'UserConfig'.`)

## Notes

- Candidate 1 was already landed in the current workspace: `apps/web/src/lib/device-sync/connect-start-route.ts` is gone and has no live imports.
- Candidate 2 was already landed in the current workspace: `apps/cloudflare/src/local-loopback-proxy.ts` now exports only `isLocalLoopbackProxyProtocol`.
- Candidate 3 was completed by narrowing `resolveHostedWake` to `HostedRuntimeDrainRequest` only while preserving the empty-drain synthetic runtime-timer fallback.
- Candidate 4 was already landed in the current workspace: runner secrets are read-only in production code.
- Candidate 5 was completed by switching `apps/cloudflare/src/user-runner.ts` to `createHostedUserKeyStoreFromEnvironment(...)`.
- Candidate 6 was completed by extracting the duplicate env-category arrays into `packages/assistant-runtime/src/hosted-env-categories.ts` and reusing them from both assistant-runtime and Cloudflare.
Completed: 2026-04-20

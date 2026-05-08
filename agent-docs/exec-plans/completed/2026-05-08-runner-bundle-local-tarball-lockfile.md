# Runner Bundle Local Tarball Lockfile

## Goal

Fix hosted-local runner bundle assembly so pnpm lockfile verification accepts the runner's generated workspace package tarballs while still rejecting uncommitted third-party dependency resolutions.

## Scope

- `apps/cloudflare/scripts/runner-bundle/dependency-install.ts`
- `apps/cloudflare/test/runner-bundle-dependency-install.test.ts`

## Constraints

- Preserve the root lockfile guard for registry packages.
- Treat generated local workspace tarballs as bundle-local artifacts, not root lockfile drift.
- Keep the change narrow and avoid touching unrelated hosted runner work.

## Plan

1. Confirm the pnpm lockfile package-key shape for generated runner tarballs.
2. Extend local package-key detection to include named `package@file:` / `package@link:` entries.
3. Add focused regression coverage for scoped workspace tarball package keys.
4. Run focused Cloudflare test coverage plus typecheck.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-bundle-dependency-install.test.ts --no-coverage` passed.
- `pnpm --dir apps/cloudflare runner:bundle:assemble-only` passed and assembled `.deploy/runner-bundle`.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/scripts/runner-bundle/dependency-install.ts apps/cloudflare/test/runner-bundle-dependency-install.test.ts` failed after Cloudflare typecheck on unrelated active Cloudflare tests: deploy automation expectations for `DeploySmokeRunnerContainer`, plus `user-runner-alarm` cleanup/browser-vault assertions.
- `pnpm typecheck` failed on unrelated active `packages/core/test/health-bank.test.ts` `.items` property errors.
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08

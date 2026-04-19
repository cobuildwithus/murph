## Goal

Hard-cut the hosted wake drain so Cloudflare commits exactly one final snapshot per wake and web rejects any snapshot-only cursor mutation.

## Scope

- `apps/web/src/lib/hosted-wake/store.ts`
- `apps/web/test/hosted-wake-store.test.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-wake-processor.ts`
- focused Cloudflare hosted wake tests proving pre-commit finalize and cleanup-only post-commit behavior

## Constraints

- Preserve the adjacent in-flight hosted wake fetch-proof and inline target-check edits already present in the worktree.
- Do not widen the external hosted runtime contract unless strictly necessary; prefer collapsing the Cloudflare state machine on top of the current runtime results.
- Treat web as the only durable owner of the committed cursor snapshot pointer.
- Hard-cut the snapshot-only cursor CAS path instead of adding compatibility shims.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-wake/store.ts apps/web/test/hosted-wake-store.test.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/runner-wake-processor.ts apps/cloudflare/test/user-runner-hosted-wake.test.ts apps/cloudflare/test/user-runner-finalize-cas-conflict.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-wake-store.test.ts apps/web/test/hosted-wake-routes.test.ts --no-coverage`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/user-runner-hosted-wake.test.ts apps/cloudflare/test/user-runner-finalize-cas-conflict.test.ts --no-coverage`

## Notes

- Architectural target: one wake, one final bundle ref, one cursor advance.
- DO-local pending commit remains pre-commit recovery only; post-commit cleanup must not publish a second snapshot.
- Repo-wide verification remains red for unrelated pre-existing worktree issues:
  - workspace boundary policy blocks `apps/web/package.json` exporting `./testing`
  - `apps/cloudflare/test/runner-container.test.ts` is missing `ownsInternalWorkerProxyToken` on a stub
  - `apps/web` typecheck still fails on missing `@privy-io/*` and `@cobuild/wire` modules plus pre-existing test typing errors
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19

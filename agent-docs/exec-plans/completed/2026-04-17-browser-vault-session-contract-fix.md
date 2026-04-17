## Goal

Land the browser-vault follow-up fixes from the watched ChatGPT thread: keep the shared hosted-control/browser session triad strict, remove the leftover plaintext browser-vault snapshot read path in Cloudflare, and hard-separate `@murphai/query/browser` from Node-shaped query modules.

## Scope

- `packages/cloudflare-hosted-control/src/client.ts`
- `packages/cloudflare-hosted-control/test/client.test.ts`
- `apps/web/app/api/browser-vault/session/route.ts`
- `apps/web/test/browser-vault-session-route.test.ts`
- `apps/cloudflare/src/browser-vault-store.ts`
- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/src/user-runner/runner-dispatch-processor.ts`
- `apps/cloudflare/test/browser-vault-store.test.ts`
- `packages/query/src/browser-snapshot.ts`
- `packages/query/src/overview.ts`
- `packages/query/src/query-projection.ts`
- `packages/query/src/query-record-data.ts`
- `packages/query/src/read-model.ts`
- `packages/query/src/search.ts`
- `packages/query/src/summaries.ts`
- `packages/query/src/timeline.ts`
- `packages/query/src/vault-source.ts`
- `packages/query/src/wearables.ts`
- `packages/query/src/wearables/candidates.ts`
- `packages/query/test/browser-entry-boundary.test.ts`
- `packages/query/test/browser-vault-snapshot.test.ts`

## Constraints

- Keep the change scoped to the supplied ChatGPT patch intent only.
- Preserve the existing hosted-control/browser session triad fix and unrelated hosted/web behavior already in progress.
- Remove the unused plaintext browser-vault snapshot read path instead of keeping it around for tests.
- Keep the browser-safe query surface off `model.ts` and off the `vault-source.ts` metadata seam so `@murphai/query/browser` does not reach Node-only imports.
- Do not widen into dashboard experiment-detail rewiring or broader browser-vault UX changes.

## Verification

- `pnpm typecheck`
- `pnpm test:diff apps/cloudflare/src/browser-vault-store.ts apps/cloudflare/src/index.ts apps/cloudflare/src/user-runner/runner-dispatch-processor.ts apps/cloudflare/test/browser-vault-store.test.ts packages/query/src/browser-snapshot.ts packages/query/src/overview.ts packages/query/src/query-projection.ts packages/query/src/query-record-data.ts packages/query/src/read-model.ts packages/query/src/search.ts packages/query/src/summaries.ts packages/query/src/timeline.ts packages/query/src/vault-source.ts packages/query/src/wearables.ts packages/query/src/wearables/candidates.ts packages/query/test/browser-entry-boundary.test.ts packages/query/test/browser-vault-snapshot.test.ts packages/cloudflare-hosted-control/src/client.ts packages/cloudflare-hosted-control/test/client.test.ts apps/web/app/api/browser-vault/session/route.ts apps/web/test/browser-vault-session-route.test.ts`
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17

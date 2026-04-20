# Browser-vault replica hard-cut landing

Status: completed
Created: 2026-04-20
Updated: 2026-04-21

## Goal

- Land the supplied browser-vault replica hard-cut patch so hosted web, hosted-run control-plane state, Cloudflare storage, and browser-vault browser loading all move from the page-shaped snapshot contract to the replica/query-client architecture.

## Success criteria

- The browser contract is `BrowserVaultReplica`, not `BrowserVaultSnapshot`, across the touched hosted web / cloudflare / assistant-runtime seams.
- Web-owned hosted cursor state publishes an exact browser-vault replica ref.
- Browser sessions decrypt replica-scoped data and expose query helpers/selectors rather than the old snapshot DTO.
- Cloudflare stores immutable browser-vault replica objects under the new replica pathing.
- Verification covers the hard-cut paths truthfully enough to show the old snapshot seam is not still wired into the active path.

## Scope

- `apps/web/**` for browser-vault loading, browser session route, hosted cursor plumbing, and directly coupled tests/docs
- `apps/cloudflare/**` for browser-vault storage and hosted runner export wiring
- directly touched shared package contracts under `packages/**`
- active plan / ledger updates for this task only

## Constraints

- Preserve unrelated dirty-tree edits and active rows already in flight.
- Treat this as greenfield: prefer the clean replica architecture over compatibility shims unless the current tree forces a narrow bridge.
- Do not widen into unrelated hosted privacy/runtime issue work already active in the repo.
- Keep private browser-vault data private; web-owned state should publish refs and session metadata, not decrypted replica contents.

## Verification

- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/browser-vault-session-route.test.ts test/browser-vault-dashboard-pages.test.tsx test/experiment-detail-private-run.test.tsx`
- `pnpm --dir packages/cloudflare-hosted-control exec vitest run --config vitest.config.ts test/client.test.ts`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/browser-vault-store.ts apps/cloudflare/src/crypto.ts apps/cloudflare/src/index.ts apps/cloudflare/src/storage-paths.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/runner-run-processor.ts apps/web/app/(dashboard)/experiments/[experimentId]/experiment-detail-client.tsx apps/web/app/(dashboard)/experiments/page.tsx apps/web/app/(dashboard)/history/page.tsx apps/web/app/(dashboard)/layout.tsx apps/web/app/(dashboard)/overview/page.tsx apps/web/app/(dashboard)/signals/page.tsx apps/web/app/api/browser-vault/session/route.ts apps/web/app/api/internal/hosted-run/commit/route.ts apps/web/app/api/internal/hosted-run/finalize/route.ts apps/web/src/components/experiments/experiment-detail/results-tab.tsx apps/web/src/lib/browser-vault/context.tsx apps/web/src/lib/browser-vault/experiment-run.ts apps/web/src/lib/hosted-ingress/store-projections.ts apps/web/src/lib/hosted-ingress/store.types.ts apps/web/src/lib/hosted-run/store.ts apps/web/test/browser-vault-dashboard-pages.test.tsx apps/web/test/browser-vault-session-route.test.ts apps/web/test/experiment-detail-private-run.test.tsx apps/web/test/hosted-run-store.test.ts packages/assistant-runtime/src/hosted-runtime/browser-vault.ts packages/assistant-runtime/src/hosted-runtime/models.ts packages/assistant-runtime/test/hosted-runtime-browser-vault.test.ts packages/cloudflare-hosted-control/src/client.ts packages/cloudflare-hosted-control/test/client.test.ts packages/hosted-execution/src/contracts.ts packages/hosted-execution/src/parsers.ts packages/hosted-execution/src/parsers/cursor.ts packages/hosted-execution/src/parsers/run-control.ts packages/query/src/browser.ts packages/query/src/browser-replica.ts packages/query/src/browser-snapshot.ts packages/query/test/browser-entry-surface.test.ts packages/query/test/browser-vault-replica.test.ts packages/runtime-state/src/hosted-storage.ts packages/runtime-state/src/index.ts packages/runtime-state/src/hosted-browser-session-keys.ts tsconfig.base.json`
- `pnpm test:smoke`
- `git diff --check -- apps/cloudflare/src/browser-vault-store.ts apps/cloudflare/src/crypto.ts apps/cloudflare/src/index.ts apps/cloudflare/src/storage-paths.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/runner-run-processor.ts apps/web/app/(dashboard)/experiments/[experimentId]/experiment-detail-client.tsx apps/web/app/(dashboard)/experiments/page.tsx apps/web/app/(dashboard)/history/page.tsx apps/web/app/(dashboard)/layout.tsx apps/web/app/(dashboard)/overview/page.tsx apps/web/app/(dashboard)/signals/page.tsx apps/web/app/api/browser-vault/session/route.ts apps/web/app/api/internal/hosted-run/commit/route.ts apps/web/app/api/internal/hosted-run/finalize/route.ts apps/web/src/components/experiments/experiment-detail/results-tab.tsx apps/web/src/lib/browser-vault/context.tsx apps/web/src/lib/browser-vault/experiment-run.ts apps/web/src/lib/hosted-ingress/store-projections.ts apps/web/src/lib/hosted-ingress/store.types.ts apps/web/src/lib/hosted-run/store.ts apps/web/test/browser-vault-dashboard-pages.test.tsx apps/web/test/browser-vault-session-route.test.ts apps/web/test/experiment-detail-private-run.test.tsx apps/web/test/hosted-run-store.test.ts packages/assistant-runtime/src/hosted-runtime/browser-vault.ts packages/assistant-runtime/src/hosted-runtime/models.ts packages/assistant-runtime/test/hosted-runtime-browser-vault.test.ts packages/cloudflare-hosted-control/src/client.ts packages/cloudflare-hosted-control/test/client.test.ts packages/hosted-execution/src/contracts.ts packages/hosted-execution/src/parsers.ts packages/hosted-execution/src/parsers/cursor.ts packages/hosted-execution/src/parsers/run-control.ts packages/query/src/browser.ts packages/query/src/browser-replica.ts packages/query/src/browser-snapshot.ts packages/query/test/browser-entry-surface.test.ts packages/query/test/browser-vault-replica.test.ts packages/runtime-state/src/hosted-storage.ts packages/runtime-state/src/index.ts packages/runtime-state/src/hosted-browser-session-keys.ts tsconfig.base.json`

## Notes

- The supplied patch was authored against an earlier snapshot; expect drift around hosted-run naming, browser-vault context state, and current Cloudflare/browser-session plumbing.
- Required audit passes completed: coverage-write added a mismatch proof, frontend-review findings were fixed, and task-finish-review reran clean.
Completed: 2026-04-21

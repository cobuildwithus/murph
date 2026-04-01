# 2026-04-02 Hosted Compat Cleanup

## Goal

- Remove hosted compatibility branches that only existed to preserve older deployed state or broader runtime-override surfaces, now that the repo has no live deployments to protect.

## Scope

- `agent-docs/exec-plans/active/{2026-04-02-hosted-compat-cleanup.md,COORDINATION_LEDGER.md}`
- `apps/cloudflare/src/{gateway-store.ts,index.ts,node-runner.ts,user-runner.ts}`
- focused `apps/cloudflare/test/{gateway-store.test.ts,node-runner.test.ts,user-runner.test.ts,workers/worker-entry.ts}`
- `packages/runtime-state/src/assistant-state.ts`
- `packages/cli/test/assistant-state.test.ts`

## Findings

- Gateway permission override reads still salvage malformed persisted rows instead of failing closed.
- The hosted user-runner Durable Object still carries a stale `runnerContainerEnvironment` concept even though forwarded env is now a per-job runtime concern.
- The Cloudflare node runner still merges a broad runtime override envelope for callback URLs and partial control-plane config even though the worker is the only real producer in-tree.
- Assistant state still exposes `receiptsDirectory` as a compatibility alias for `turnsDirectory`.

## Constraints

- Preserve the current hosted reliability mechanics: resume handling, durable commit/finalize callbacks, and native container invoke flow stay intact.
- Keep the change limited to dead compatibility behavior, not broader architectural refactors.
- Preserve unrelated dirty-tree edits already present in the repo.

## Plan

1. Make gateway override storage strict so malformed persisted rows fail instead of being partially normalized.
2. Remove the stale DO-level "container env" layer and build forwarded runner env from raw worker env only when dispatching a job.
3. Hard-cut node-runner support for generic runtime URL/control-plane override input and keep callback override plumbing test-only.
4. Remove the `receiptsDirectory` assistant-state alias and update the small remaining caller/test surface to `turnsDirectory`.
5. Run focused verification plus required checks, then close and commit the scoped cleanup.

## Verification Target

- Focused tests under `apps/cloudflare/test/{gateway-store,node-runner,user-runner}.test.ts`
- Focused assistant-state test coverage in `packages/cli/test/assistant-state.test.ts`
- Package-local and repo verification where the current tree allows it

## Status

- Completed
- Updated: 2026-04-02

## Outcome

- Gateway permission override storage now fails closed on malformed persisted rows instead of salvaging partial entries.
- Hosted runner dispatch now derives forwarded runtime env from raw worker env at job dispatch time instead of carrying a stale DO-level cached "container env" concept.
- The Cloudflare node runner no longer accepts generic runtime callback/control-plane override input outside the remaining explicit test hooks.
- Assistant state now exposes only `turnsDirectory` for the receipts path.

## Verification Result

- `./node_modules/.bin/vitest run --coverage=false --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/gateway-store.test.ts apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/user-runner.test.ts`
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/assistant-state.test.ts --no-coverage`
- `./node_modules/.bin/tsc -p apps/cloudflare/tsconfig.json --pretty false`
- `./node_modules/.bin/tsc -p packages/runtime-state/tsconfig.json --noEmit --pretty false`
- `pnpm typecheck`
- `pnpm test` failed for a pre-existing release-manifest check outside this cleanup: `packages/cli/test/release-script-coverage-audit.test.ts` reports `packages/inboxd` and `packages/assistant-runtime` depending on `@murphai/messaging-ingress` without that package being present in the release manifest publish set.
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02

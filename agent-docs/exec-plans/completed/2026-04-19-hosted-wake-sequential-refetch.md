## Title

Fix hosted wake stale-batch execution and quarantine fence invalidation.

## Goal

Keep rapid hosted inbound turns safe and low-latency by ensuring Cloudflare refetches after each successful cursor advance instead of executing later wakes under a stale fetched proof, and by making quarantine invalidate stale fetch proofs the same way coalescing rewrites do.

## Scope

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/test/user-runner-hosted-wake.test.ts`
- `apps/web/src/lib/hosted-wake/store.ts`
- focused `apps/web/test/hosted-wake-store.test.ts`
- active plan / ledger cleanup directly tied to this slice

## Constraints

- Preserve the current post-CAS finalize flow for committed assistant delivery effects.
- Keep the change narrow to hosted wake correctness; do not broaden into unrelated Cloudflare or hosted onboarding behavior.
- Work on top of in-flight nearby hosted wake edits without reverting them.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-hosted-wake.test.ts apps/web/src/lib/hosted-wake/store.ts apps/web/test/hosted-wake-store.test.ts`
- `pnpm test:smoke`
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/user-runner-hosted-wake.test.ts --no-coverage`
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/hosted-wake-store.test.ts`

## Notes

- The runner should stop consuming the current fetched batch after any successful cursor advance and refetch before executing another wake.
- Quarantine should invalidate stale fetch proofs just like unresolved coalescing rewrites do, so row-state changes cannot be committed under the previous fence.
- Focused hosted-wake proofs are green in both apps; broader `pnpm typecheck` / `test:diff` remain blocked by unrelated pre-existing Cloudflare-wide type drift and missing package resolution in other test files.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19

# PR 344 Retention Inactive Fence

## Goal

Fix the retention-mode variant where a runtime fence can be proven inactive, then preserved after a later redundant wake path loses that proof.

## Constraints

- Keep the inactive-fence owner singular: confirmed inactive routes through replacement.
- Do not add a route, persisted state, scheduler, or new recovery abstraction.
- Preserve active and indeterminate liveness as retry-only.

## Plan

1. Route same-mode `inbox_media_retention` inactive liveness directly to replacement.
2. Add a focused regression proving the earlier inactive proof is not lost when the wake path would exhaust budget.
3. Run focused Cloudflare runner tests and typecheck.
4. Commit and push the PR head.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runtime-invocation-transport-failure.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-container.test.ts`
- `pnpm --dir apps/cloudflare typecheck`
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30

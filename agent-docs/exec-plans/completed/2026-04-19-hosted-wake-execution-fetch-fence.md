## Title

Reject mismatched execution fetch cursors before web mints hosted-wake fetch proofs.

## Goal

Close the hosted-wake execution seam where web can still mint executable fetch proofs after a caller-supplied future `afterSeq`, even though cursor commit is now single-step.

## Scope

- `packages/hosted-execution/src/contracts.ts`
- `apps/cloudflare/src/{web-control-plane,user-runner}.ts`
- focused `apps/cloudflare/test/**` wake-control proofs
- `apps/web/src/lib/hosted-wake/store.ts`
- `apps/web/src/lib/hosted-wake/store.types.ts`
- `apps/web/app/api/internal/hosted-wake/unseen/route.ts`
- focused hosted-wake regression tests under `apps/web/test/**`

## Constraints

- Keep the execution fetch route contiguous to web's current committed cursor only.
- Remove the stale caller-controlled cursor input instead of preserving it behind compatibility affordances.
- Do not introduce a new pagination/debug route in this patch.
- Do not weaken hosted wake commit/terminal invariants or broaden adjacent wake-recovery work already in flight.
- Preserve overlapping dirty-tree edits outside this exact trust-boundary fix.

## Verification

- attempted: `pnpm typecheck`
- attempted: `bash scripts/workspace-verify.sh test:diff packages/hosted-execution/src/contracts.ts apps/cloudflare/src/web-control-plane.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/test/web-control-plane.test.ts apps/cloudflare/test/user-runner-hosted-wake.test.ts apps/cloudflare/test/user-runner.test.ts apps/cloudflare/test/workers/test-hosted-wake-control.ts apps/web/src/lib/hosted-wake/store.ts apps/web/src/lib/hosted-wake/store.types.ts apps/web/app/api/internal/hosted-wake/unseen/route.ts apps/web/test/hosted-wake-store.test.ts apps/web/test/hosted-wake-routes.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-wake-store.test.ts -t "lists executable wake proofs from the current committed cursor" --no-coverage`
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-wake-routes.test.ts -t "parses and forwards unseen wake fetch requests" --no-coverage`
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-wake-routes.test.ts -t "rejects caller-supplied afterSeq on executable unseen wake fetch requests" --no-coverage`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/web-control-plane.test.ts -t "fetches hosted wake batches from the web control plane" --no-coverage`

## Notes

- The required regression proof is: committed seq `0`, wake seq `1` and `2` exist, and an execution fetch request with `afterSeq=1` must not receive an executable fetch proof for seq `2`.
- The clean end shape is a contract cut: execution fetch no longer accepts caller cursor state at all, and proof minting depends only on web's current committed cursor.
Status: completed
Updated: 2026-04-24
Completed: 2026-04-24

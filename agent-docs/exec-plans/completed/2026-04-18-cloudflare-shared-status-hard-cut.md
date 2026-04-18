## Goal

Remove remaining dispatch-era live naming and observability residue from the Cloudflare/shared-status owned slice, and confirm whether any real legacy queue-correctness ownership still exists in Cloudflare/runtime-state paths.

## Scope

- `apps/cloudflare/src/**`
- `packages/hosted-execution/src/observability.ts`
- `packages/runtime-state/src/**` only if inspection shows a real legacy queue/store seam
- matching tests only

## Constraints

- Preserve unrelated worktree edits.
- Bias toward deleting compatibility naming and dead residue rather than preserving it.
- Keep the change production-narrow unless durable docs must change to match actual ownership.

## Questions To Answer

1. Is `dispatch.running` still live anywhere in the owned slice, and if so is it canonical or residue?
2. Do `runner-container` / `user-runner` names still reflect live behavior, or only stale compatibility wording?
3. Does any `dispatch-payload` naming or storage path still represent old queue truth?
4. Does any schema/store path in the owned slice still claim legacy queue correctness ownership that should now be deleted or renamed?

## Verification Plan

- `pnpm typecheck`
- truthful scoped coverage via `pnpm test:diff <paths...>` if it covers the touched owners; otherwise targeted owner coverage command(s)
- `pnpm test:smoke`

## Audit Plan

- Required `coverage-write` pass if verification uses owner/diff coverage
- Required `task-finish-review` pass

## Status

- `dispatch.running` was live residue in the owned Cloudflare + hosted-execution slice; it is now `wake.running`.
- Public `HostedExecutionUserStatus` is now wake-native (`pendingWakeCount`) and no longer exposes queue-era compatibility fields.
- Cloudflare runner state no longer reads or writes the internal `retrying_event_id` seam; active store truth is now `last_event_id` plus active-run lease state.
- Matching Cloudflare test helpers now use the wake-native helper path (`hosted-local-wake.ts` / `runWake`) instead of the removed dispatch-era alias.
- `task-finish-review` found one useful low-severity gap: the user-status parser still tolerated removed queue-era keys. That fail-closed parser check and focused coverage test were added.
- `coverage-write` was launched and exited `0` without changing the worktree, but the helper did not capture a final text summary.

## Verification Results

- `pnpm --dir packages/hosted-execution typecheck` ✅
- `pnpm --dir packages/hosted-execution test:coverage` ✅
- `pnpm --dir packages/runtime-state typecheck` ✅
- `pnpm --dir packages/runtime-state test:coverage` ✅
- `pnpm --dir packages/cloudflare-hosted-control typecheck` ✅
- `pnpm --dir packages/cloudflare-hosted-control test:coverage` ✅
- `pnpm --dir apps/cloudflare verify` ✅

## Remaining Answer

- No active legacy queue-correctness owner remains in the reviewed production slice. Web still owns wake ordering/high-water truth. The removed Cloudflare public compatibility fields and inactive `retrying_event_id` seam were the last owned residues. Old SQLite rows may still physically carry the dropped column, but the live store/schema code no longer reads, writes, or requires it.
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18

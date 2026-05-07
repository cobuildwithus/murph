# WHOOP Biomarkers Local Sync

## Goal

Diagnose and fix the mismatch where a locally connected WHOOP source appears synced on `/connect` but does not surface data on `/biomarkers`.

Success criteria:

- `/connect` sync status and `/biomarkers` private trend data agree on the same local/imported device evidence.
- The fix preserves device-token privacy and canonical vault/query ownership.
- Focused tests cover the mismatch.

## Constraints

- Do not print or persist secrets, provider tokens, raw health payloads, local account names, or home-directory paths.
- Preserve unrelated dirty work and active ledger rows.
- Keep local wearable data canonical in vault/import/query seams, not in app-only runtime state.

## State

Implemented; verification mostly complete. Commit is blocked by unrelated and overlapping dirty worktree state.

## Findings

- Local device-sync state shows WHOOP active with a completed sync and no sync error.
- The Oura/Junction connection failed independently and scheduled a later retry; it did not block the WHOOP sync row.
- `/connect` reads hosted device connection state, while `/biomarkers` reads the browser-vault replica.
- The local hosted workspace had only hot/layered checkpoints and no browser-vault replica ref, so `/biomarkers` had no private dashboard snapshot to load.
- Hot checkpoints intentionally omit browser-vault sidecars; the browser-vault replica is published by a full/idle-shutdown checkpoint.
- A later provider retry could prevent idle-shutdown compaction from running first, delaying dashboard publication indefinitely in this local shape.

## Fix

- Allow idle-shutdown compaction to be scheduled before a later workspace wake, while preserving the later wake in runner state.
- Preserve workspace `nextWakeAt`/`nextWakeReason` through idle-shutdown checkpoint requests.
- If runtime liveness reports new input while the idle checkpoint write is in flight, return the pending wake with the committed checkpoint result so cleanup does not treat it as a clean shutdown.

## Working Set

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/test/user-runner-alarm.test.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `apps/web/**` `/connect` and `/biomarkers` surfaces inspected only
- local Postgres hosted device/workspace/runtime log tables inspected only

## Verification Plan

- Passed: `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint.test.ts --no-coverage`.
- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts`.
- Passed: `pnpm --dir packages/assistant-runtime typecheck`.
- Passed: `pnpm --dir apps/cloudflare typecheck`.
- Blocked: root `pnpm typecheck` waited on an existing `apps/web` verification lock and was stopped without killing the other process.
- Broader Cloudflare node workspace run hit unrelated `apps/cloudflare/test/container-entrypoint.test.ts` socket hang-up failure while the focused runner file passed.
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08

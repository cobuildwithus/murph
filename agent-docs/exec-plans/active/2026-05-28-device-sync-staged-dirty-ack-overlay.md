# Device Sync Staged Dirty Ack Overlay

## Goal

Prevent hosted device sync from re-consuming the same dirty payload rows inside
one uncheckpointed runtime invocation while still allowing the runtime to drain
additional dirty batches before the normal durable checkpoint.

## Constraints

- Keep one durable workspace checkpoint.
- Do not acknowledge/delete dirty rows before that checkpoint.
- Do not add a queue, table, worker, or Cloudflare orchestration behavior.
- Keep Cloudflare as a thin signed callback forwarder.
- Keep raw payloads and health data out of logs and docs.

## Plan

1. Add a dirty-pending request overlay field carrying staged dirty ack records.
2. Teach web dirty-pending reads to exclude staged payload ids and honor staged
   processed revisions without mutating the database.
3. Accumulate staged dirty ack records in the hosted runtime invocation and pass
   them into later device-sync dirty-pending fetches.
4. Keep the existing post-checkpoint dirty ack as the only durable delete point.
5. Add focused regression coverage for duplicate suppression and continued batch
   draining before checkpoint.

## Verification

- Focused unit tests for contracts, web dirty-pending store behavior, and hosted
  runtime/device-sync pass behavior.
- `pnpm typecheck`
- Scoped diff or owner coverage command covering touched files.

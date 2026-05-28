# Device Sync Batched Dirty Work

## Goal

Speed up hosted device-sync dirty work handoff without adding a second queue, lease protocol, or durable owner. The runtime should be able to checkpoint and acknowledge multiple exact dirty payload batches per pass, and web-side dirty payload hydration should avoid silently truncating direct webhook JSON.

## Scope

- Keep `device_sync_dirty_payload` as the durable source of exact webhook work.
- Change the hosted runtime dirty handoff from one pending ack to a bounded list of exact dirty acks.
- Record plural dirty acks through the existing system-mailbox post-checkpoint seam.
- Keep each ack exact by connection id, processed revision, and explicit dirty payload row ids.
- Raise the per-connection dirty payload hydrate page modestly only with safer direct-webhook payload handling.
- Add regression tests for plural checkpoint-safe dirty acks and non-truncated oversized direct webhook JSON.

## Non-Goals

- No new dirty queue, cursor lease, Cloudflare-owned dirty store, or provider-specific state in `apps/web`.
- No unbounded provider/job parallelism.
- No Temporal workflow state or signal payload expansion.
- No provider-level Junction batch-job redesign in this increment.

## Verification

- Focused assistant-runtime hosted device-sync/runtime mailbox tests.
- Focused hosted-web Prisma dirty-connection tests.
- `pnpm typecheck`.
- Diff/privacy checks before commit.

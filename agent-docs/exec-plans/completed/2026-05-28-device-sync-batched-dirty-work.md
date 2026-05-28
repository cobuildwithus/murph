# Device Sync Batched Dirty Work

## Goal

Speed up hosted device-sync dirty work handoff without adding a second queue, lease protocol, or durable owner. The runtime should be able to checkpoint and acknowledge multiple exact dirty payload batches per pass, and web-side dirty payload hydration should avoid silently truncating direct webhook JSON.

## Scope

- Keep `device_sync_dirty_payload` as the durable source of exact webhook work.
- Change the hosted runtime dirty handoff from one pending ack to a bounded list of exact dirty acks.
- Record plural dirty acks through the existing system-mailbox post-checkpoint seam.
- Keep each ack exact by connection id, processed revision, and explicit dirty payload row ids.
- Raise the per-connection dirty payload hydrate page modestly only with safer direct-webhook payload handling.
- Add a global pending-response payload budget so one request cannot hydrate an unbounded number of large direct payload rows.
- Keep dirty ack lightweight: mutate exact rows and compute pending state with existence checks, not by decrypting remaining payload rows.
- Add regression tests for plural checkpoint-safe dirty acks and non-truncated oversized direct webhook JSON.

## Non-Goals

- No new dirty queue, cursor lease, Cloudflare-owned dirty store, or provider-specific state in `apps/web`.
- No unbounded provider/job parallelism.
- No Temporal workflow state or signal payload expansion.
- No provider-level Junction batch-job redesign in this increment.

## Verification

- Focused assistant-runtime hosted device-sync/runtime mailbox tests.
- Focused hosted-web Prisma dirty-connection tests.
- Focused hosted-web dirty runtime authority tests.
- `apps/web` prepared typecheck.
- `pnpm typecheck`.
- Diff/privacy checks before commit.

## Outcome

- Runtime collects multiple exact dirty acks per bounded pending fetch.
- System mailbox persists a bounded dirty-processed batch record for rollback-compatible post-checkpoint retry, while still accepting existing singular records.
- Dirty pending hydration is capped per connection and across a response.
- Dirty ack no longer hydrates/decrypts remaining payload rows after delete.
- Oversized direct webhook JSON is omitted from inline payloads without changing durable payload-row storage class.
Status: completed
Updated: 2026-05-28
Completed: 2026-05-28

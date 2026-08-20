# Project Canonical Imports Into Companion Freshness

Status: active
Updated: 2026-08-20

## Goal

Make the native companion's source-scoped freshness state reflect successful
canonical imports triggered by data-less historical completion notifications,
without weakening the existing source-arrival stall signal.

## Root-Cause Evidence

- The native manual check is bounded and reaches a terminal local outcome.
- Signed historical completion notifications are durably accepted and enqueue
  source-scoped resource jobs, but correctly do not count as data-bearing
  webhook receipts.
- The hosted runtime successfully completes the corresponding canonical
  resource imports and acknowledges their exact dirty payload rows.
- The companion status read model consumes only data-bearing webhook signals,
  so a later successful pull import has no durable primary-database receipt and
  cannot advance the visible source-scoped timestamp.
- The connection source's `lastDataAt` intentionally measures push-carrier
  arrival. Advancing it from a pull import would hide real delivery stalls and
  is not an acceptable fix.

All production evidence was inspected read-only and is omitted from repository
artifacts.

## Product UX Patch

- Outcome: a successful canonical Apple Health import becomes visible as fresh
  backend-confirmed sync evidence.
- Reaches: the existing native status journey after a manual or background
  historical pull, including later refresh, foreground, and relaunch reads.
- Proof: focused protocol, retry-idempotency, store, and companion-status tests
  show successful imports advance the matching resource and overall timestamp,
  while data-less notification acceptance, failures, disconnect cutoffs, and push
  stall state remain unchanged.

## Affected People And Recovery

- A connected Apple Health member with new readable data sees freshness advance
  after canonical import succeeds, not when a data-less notification arrives.
- A data-less provider notice never advances freshness by itself. A connected
  member whose pull has no canonical records, is source-fenced, is still
  running, or fails keeps the existing waiting or recovery state; no optimistic
  success is introduced.
- A disconnected source cannot revive old import evidence across its receipt
  cutoff.
- Other Junction sources use the same source-scoped evidence rule without
  changing provider input, source lifecycle, or push-stall detection.

## Constraints

- Web/Postgres remains the durable control-plane and companion-status owner.
- Persist import evidence on the exact local job only after the canonical
  importer returns at least one event, then expose it only after job success
  and the existing checkpoint boundary.
- Preserve exact dirty-payload ownership through one-at-a-time scheduled
  continuations and cold-restored wake hints until the owning job reaches a
  terminal decision.
- Make callback replay idempotent by coupling receipt creation to deletion of
  the exact acknowledged dirty payload in one short database transaction.
- Keep callback fields bounded, closed, member-bound, and free of health values
  or provider payloads.
- Do not add a queue, scheduler, source-lifecycle mutation, or runtime-log read.
- Preserve existing active/disconnected source predicates and receipt cutoffs.

## Plan

1. Persist the true data-bearing canonical importer completion time on the exact
   local job, then extend the shared dirty-ack contract with bounded per-payload
   receipts carrying only payload id, normalized resource/source, and
   completion time.
2. Preserve those receipts through hosted runtime checkpoint state and the
   signed Cloudflare callback; when a no-import job schedules one continuation,
   transfer its exact payload ownership to that child and retain the transfer
   in cold-restore hints.
3. In the Web dirty-ack transaction, create canonical-import signal rows only
   for exact payload rows that still exist, then delete those rows. Exact retry
   therefore cannot create a second receipt.
4. Read webhook and canonical-import signals through the same bounded companion
   status query, using import completion time for canonical receipts and the
   established disconnected-source cutoff for both.
5. Update the control-plane and companion contracts, add focused regression
   coverage, and run scoped verification.
6. Push an exact candidate and run the Product UX/coverage specialist pass,
   final sensitive ReviewGPT gate, and required CI concurrently.

## Verification

- Root cause: proven through the current native client, Web read model, hosted
  runtime completion path, primary control-plane state, and redacted runtime
  completion evidence.
- Shared protocol parser: 100 focused tests passed.
- Runtime checkpoint, replay, and mailbox flow: 2,419 tests passed with five
  skipped; assistant-runtime typecheck passed.
- Web authority, exact-payload idempotency, signal read, and companion status:
  227 focused tests passed; prepared Web typecheck and focused lint passed with
  two unrelated existing test warnings.
- Cloudflare callback forwarding: one focused test passed with 191 unrelated
  cases skipped; Cloudflare typecheck passed.
- Changelog generation and archive/feed/page coverage: 57 focused tests passed.
- Preliminary specialist review found that generic job success also includes
  zero-record and source-fenced no-ops. The correction now records a nullable
  SQLite v11 job receipt only when `importSnapshot` returns at least one
  canonical event, leaves no-op job acknowledgement independent, carries exact
  ownership through a single scheduled continuation and cold restore, and uses
  that receipt's timestamp downstream.
- Corrected device-syncd coverage: 1,255 tests passed. Corrected
  assistant-runtime coverage: 2,420 passed with five expected skips. ReviewGPT
  round 2, required CI, and final deployment compatibility proof: pending.

# Project Canonical Imports Into Companion Freshness

Status: completed
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
- Persist only bounded exact source/resource identities derived from committed
  canonical events on the local job, then expose a matching receipt only after
  job success and the existing checkpoint boundary.
- Never infer payload ownership from job success, child cardinality, scheduled
  verification, reconciliation, or broad backfill work.
- Make callback replay idempotent by coupling receipt creation to deletion of
  the exact acknowledged dirty payload in one short database transaction.
- Keep callback fields bounded, closed, member-bound, and free of health values
  or provider payloads.
- Do not add a queue, scheduler, source-lifecycle mutation, or runtime-log read.
- Preserve existing active/disconnected source predicates and receipt cutoffs.

## Plan

1. Persist the true data-bearing canonical importer completion time and exact
   normalized source/resource identities on the local job, then extend the
   shared dirty-ack contract with bounded per-payload receipts carrying only
   payload id, normalized resource/source, and completion time.
2. Preserve exact matching receipts through hosted runtime checkpoint state and
   the signed Cloudflare callback. A scheduled child is independent work and
   never inherits the original payload's freshness authority.
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
- Runtime checkpoint, replay, and mailbox flow: the full assistant-runtime
  suite passed 2,422 tests with five skipped; assistant-runtime typecheck
  passed.
- Web authority, exact-payload idempotency, signal read, companion status, and
  changelog coverage passed 288 focused tests with nine skipped; prepared Web
  typecheck passed.
- The full Cloudflare node suite passed 2,601 tests with two skipped;
  Cloudflare typecheck passed.
- Preliminary specialist and final round-one review found that generic job
  success includes zero-record and source-fenced no-ops. Final round two then
  proved that the first remediation still inferred exact payload truth from any
  positive import in a sole scheduled child.
- The required anomaly retrospective chose deletion and redesign: remove the
  continuation relation, child-owner traversal, and dirty-payload wake hints;
  replace the job-global timestamp with one bounded SQLite v11 exact receipt
  set derived from the existing committed importer result. Scheduled children
  acknowledge no-import parents without freshness and unrelated identities
  never match.
- Regression proof first failed under the continuation design, then passed
  after deletion. The full device-syncd suite passed 1,255 tests, including the
  exact-identity and scheduled-child regression, and both production-shaped
  Junction late-sleep recovery paths passed. Device-syncd typecheck passed.
- Final ReviewGPT round three found review-induced dirty-payload retention
  plumbing whose only producer had already been deleted by the exact-receipt
  redesign. That unreachable cross-fetch channel was deleted instead of
  retained as speculative complexity. The production pass now has one explicit
  authoritative dirty-state fetch owner, while a cold retry refetches the Web
  source of truth.
- The focused runtime and production-pass tests passed 212 tests on current
  main. The full assistant-runtime suite passed 2,422 tests with five skipped,
  and assistant-runtime typecheck passed.
- The clean follow-up PR full-snapshot ReviewGPT audit returned PASS with no
  findings. It independently confirmed the single authoritative fetch, cold
  refetch and relinking, exact receipt gate, staged acknowledgements, retries,
  and checkpoint promotion. Required CI and production rollout remain release
  gates outside this completed implementation plan.
Completed: 2026-08-20

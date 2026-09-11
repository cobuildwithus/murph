# Remove redundant work from hot replies

Status: active
Created: 2026-09-11
Updated: 2026-09-11

## Outcome and invariants

Reduce accepted-message latency by deleting redundant database work. Preserve
durable mailbox ownership, signal failure recovery, current execution and effect
authorization, usage denial confirmation, and foreground completion ordering.
No new state, cache, service, dependency, or protocol.

## Evidence and ownership

The signal owner repeats active-access reads for caller-supplied append facts.
The append already owns admission; runtime mailbox fetch and provider egress
retain current access checks. The signal carries only an existing durable
pointer. Remove this redundant read only for the existing known-checkpoint path.

The usage owner wraps read-only allowance reads in an interactive transaction
without a stronger isolation level or locks. Remove that wrapper; retain the
locked mutating gate for denial confirmation and accounting. Explicit caller
transactions, including repeatable-read report snapshots, remain caller-owned.

Audit the composed Web, Worker, and runtime path for network and filesystem
work. Record retained operations and justified deletion opportunities without
private production evidence. Current main already overlaps direct wake with
Temporal acknowledgement and decodes inline payloads in the mailbox response.

## Product UX

- Outcome: Faster existing hot replies with unchanged reply content and routing.
- Reaches: Established direct and group conversation inputs; denial, cancellation,
  wrong-owner, and retry paths.
- Proof: Focused production-owner tests for call counts, ordering, read-only
  usage decisions and transactional denial recovery. No prompt or tool changes.

## Tasks

1. Complete call-tree audit and deletion decisions.
2. Add regression proof, remove redundant work, update owning contracts.
3. Run focused tests and Web typecheck; review full diff and complexity.
4. Add a scoped changelog entry, commit, push and open draft PR.
5. Complete Ready admission, final ReviewGPT and exact-head CI; close plan.

## Deployment and failure

Web-only behavior change with unchanged request/response schemas; old and new
Workers and warm runtimes remain compatible. No migration or deployment ordering.
The durable signal still must succeed before webhook acknowledgement, and its
existing retry path remains intact. Usage denial still rereads under the
authoritative locked transaction. Production latency improvement requires
post-deploy measurement and is not claimed from synthetic tests.

## Verification

- Focused signal, usage allowance, runtime usage decision and internal-route tests:
  279 passed. New call-count regressions failed on the base implementation.
- Web typecheck passed. Complexity diff passed; existing allowance-owner hotspots
  unchanged. Parent candidate review confirms no new authority or state owner.
- Changelog archive tests: 10 passed. Release note reviewed under the content-only
  presentation exception. Product UX: Ready.
- Draft PR: #3316. Final ReviewGPT and exact-head CI pending.

## Composed hot-path audit

The requirement is to durably receive a message, process it once under current
member authority with the necessary conversation context, and hand off a reply.
A wake hint does not need to reconstruct facts the append already committed.

| Work | Current purpose and decision |
| --- | --- |
| Signal admission member/participant queries | Delete for committed append facts: one member query, plus at most one participant query, removed before direct wake and Temporal start. Uncached admission stays. |
| Temporal signal and direct Worker wake | Keep durable recovery plus responsive resident execution. Current main already overlaps them; webhook success still requires the signal. |
| Active runner fence | Keep single-writer and effect authority. Warm wake already skips new-session admission HTTP. |
| Signed mailbox-fetch HTTP and replay nonce | Keep the current durable input and live member/consent boundary. One bounded page projection; no per-message SQL fanout. |
| Read-first usage transaction | Delete transaction setup/commit on allowed reads. Same sequential queries; one period read for a supplied ordinary paid member, conditional bounded Family/participant reads for those actual access models. No new concurrency, writes, locks, external work or collection fanout. |
| Denial confirmation and spend transactions | Keep fresh authoritative state and locked accounting. Caller-owned repeatable-read reporting remains unchanged. |
| Inline payload decoding | Keep authenticated local decryption, already piggybacked on fetch by current main. Existing envelope cache avoids repeat root work; noninline payloads retain their required fetch. |
| Import checkpoint and input staging | Keep small cursor read and durable event writes for replay/recovery. Deferred checkpoint path already avoids rollback-state rediscovery. No hot snapshot extraction. |
| Pending-input rediscovery before a fresh turn | Separate runtime PR removes the index/automation/receipt scan when exact freshly staged input IDs already prove foreground work. |
| Causal system completion and cross-session context | Keep earlier Ask completion ordering and explicit reply/scheduled-message context. Exact fresh input IDs bound the oldest-input check. |
| Typing provider request | Keep the requested visible effect. Its acknowledgement remains a separate latency component. |
| Idle snapshot, maintenance and diagnostics | Already deferred or nonblocking on the normal fresh path; do not rebuild these as another cache or scheduler. |

Production timing must be measured after deployment. Call-count tests prove
removed work, not a millisecond reduction or a change already live in production.

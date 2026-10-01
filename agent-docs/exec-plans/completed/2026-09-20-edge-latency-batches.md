# Batch simultaneous runtime latency milestones

Status: completed
Created: 2026-09-20
Updated: 2026-09-20

## Goal and protected invariant

Reduce callback requests when one runtime observation already contains multiple
latency milestones. Preserve timestamps, per-event retry budgets, fresh runtime
fences, early typing alerts, and failure isolation from member replies.

## Owner and evidence

The assistant milestone helper currently maps one milestones array to independent
HTTP calls. The provider observer can supply first-output and first-text together.
Extend the existing latency port, signed callback, parser and Web persistence
owner; do not add a queue, timer, persistent state, or generic batch service.

## Scope and decisions

- Accept bounded assistant-milestone arrays on the existing latency route; keep
  every deployed singleton request and response unchanged.
- Validate the complete batch and all attempt fences before persistence. Process
  events serially and return positional results, isolating per-event failures.
- Send already-available milestones immediately. Retry only failed/unmatched
  events at the existing delays; preserve the detached staging race recovery.
- Bound payloads and event cardinality. No new invocation-end buffer exists.
- Extend existing Web deployment admission to require the compatible parser
  before new Worker activation. Old Worker/warm-runner singleton traffic remains
  valid. Deploy Web first; retain the batch reader until new producers drain.
- No model, prompt, tool, reply, provider, mailbox or billing behavior changes.

## Risks and proof

Prove pair-to-one request reduction through the real sender/transport seam;
legacy port fallback; partial success; late staging; transport and malformed
response retries; preserved timestamps; complete prevalidation; fence mismatch;
body and event bounds; typing alert scheduling; old singleton/new reader and
old-reader deployment rejection. Keep finite sequential database fanout.

## Tasks

1. Implement the compatible consumer, protocol admission and optional batch port.
2. Batch only the existing simultaneous array and retain per-event retry ownership.
3. Run focused contract, runtime, transport, Web and deploy tests, affected
   typechecks and complexity guard; inspect the final diff.
4. Update the owner and index, commit and open a draft PR. Parent owns final
   ReviewGPT, candidate acceptance, Ready transition and exact-head CI.

## Verification

Passed focused verification (238 tests across seven files):

- Assistant runtime milestone batching and channel activity: 38 tests.
- Web internal routes and protocol admission: 124 tests, including actual request
  byte-limit enforcement, serial writes, partial failures and original singleton
  behavior.
- Cloudflare latency transport and Web deploy admission: 33 tests.
- Hosted execution control contracts: 43 tests.
- Typechecks for assistant-runtime, hosted-execution, Cloudflare and Web.
- `pnpm complexity:diff` and `git diff --check`.

The pair-to-one proof preserves original event timestamps and sends without a
coalescing timer. Mixed-version proof accepts old singleton requests on the new
reader, retains legacy ports, and rejects a batch-incompatible Web at the existing
deployment gate. Retry tests cover null results, unmatched staging, lost transport
and malformed result cardinality. The abort guard covers both port methods.

Final edge-case review: a lost batch response can retry already-written events,
which retains the existing idempotent milestone store semantics. Fences remain
validated by each store call; batch prevalidation is not a replacement for that
check. Serial batch writes are bounded at eight, with unchanged request timeout
and three attempts per event. The existing detached milestone lifecycle remains
best-effort; no new buffer or shutdown flush obligation is introduced.

Local implementation and proof are complete. The parent completion owner handles
final ReviewGPT, candidate acceptance, Ready transition and exact-head CI after
the draft PR is pushed. No production requests, deployment, merge or mutation
are part of this lane.
Completed: 2026-09-20

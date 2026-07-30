# Assistant Ask bounded handoff port

Status: active
Created: 2026-07-30

## Goal

- Port the bounded Assistant Ask mailbox wake handoff from the stale PR onto
  current `main`.
- Return request or completion success only after Temporal accepts the durable
  mailbox signal.
- Replay an exact, idempotent Assistant Ask control request once when a
  retryable response or response-body failure makes the result ambiguous.

## Proven cause

- Web commits the encrypted mailbox item, then schedules the Temporal signal
  with `after()` and swallows signaling failure.
- The HTTP caller can therefore observe success before any durable wake owner
  accepts the work.
- Current `main` has added a separate Assistant Ask control port and the
  `ask_current_sender` action since the original patch was written.

## Constraints

- Keep the encrypted mailbox as the only durable Assistant Ask queue and
  operation state.
- Keep Temporal as the sole durable wake and reconciliation owner.
- Start the payload-free direct Cloudflare wake only after Temporal accepts the
  signal, and keep it best effort.
- Retry only exact request shapes whose stable mailbox identities make replay
  idempotent; do not add a queue, receipt, scheduler, or persisted retry state.
- Propagate the caller abort signal and keep all attempts inside one existing
  control-plane timeout budget.

## Approach

1. Replace the deferred wake scheduler with one bounded, awaited handoff.
2. Await it at the request and completion HTTP boundaries.
3. Extend the current Cloudflare web-control transport with one optional exact
   replay under a shared deadline and bounded response-body reads.
4. Enable exact replay for all current idempotent Assistant Ask request and
   completion adapters, including `ask_current_sender`.
5. Add focused failure, ordering, timeout, and exact-replay regressions.

## Verification

- Focused Web tests for mailbox handoff, group-tool request routes, and the
  Assistant Ask completion route.
- Focused Cloudflare tests for all current Ask adapters and transport response
  ambiguity cases.
- Exact pushed-head CI, preliminary completion-specialists ReviewGPT, parent
  final review, and final ReviewGPT rounds.

## Deployment

- Web and Cloudflare control-flow change only; no schema, wire-shape, or
  persisted-state change.
- Determine and document the safe deploy order and temporary skew behavior
  before final handoff.

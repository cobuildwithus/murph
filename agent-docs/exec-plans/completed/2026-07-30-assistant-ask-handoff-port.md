# Assistant Ask bounded handoff port

Status: completed
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

Completed local proof:

- Focused Web: 4 files, 137 tests passed; Web prepared typecheck and targeted
  lint passed.
- Focused Cloudflare plus shared transport: 5 files, 159 tests passed;
  Cloudflare typecheck passed.
- Assistant Engine current-turn boundary: full 240-test runtime file passed;
  Assistant Engine typecheck passed.
- Assistant Runtime group-context boundary: 20 tests passed; Assistant Runtime
  typecheck passed.
- Hosted-local `temporal-orchestration` full-stack E2E: 2 tests passed against
  the real local Web, Cloudflare runner, database, and managed Temporal stack.
- Signed loopback direct scenarios proved one exact replay after HTTP `503` and
  no second POST after foreground cancellation.

Preliminary specialist disposition:

- Accepted the cancellation finding and propagated the existing foreground
  signal through Assistant Engine, the current-turn runtime wrapper, and the
  Cloudflare group-tool port. Regression and direct proof now cover the
  canceled retry boundary.
- Addressed the requested cross-runtime evidence with the existing hosted-local
  Temporal scenario plus the existing Web ordering, signed control transport,
  and Assistant Ask completion integration boundaries. No test-only Temporal
  controls or parallel orchestration harness were added.

Parent product-experience revalidation:

- Pass. The corrected flow keeps the existing entry point and destination,
  makes acceptance truthful at the durable Temporal boundary, preserves the
  mailbox as reconciliation truth, and ties replay cancellation to the
  initiating turn.
- The stable owner-boundary tests, hosted-local Temporal scenario, and signed
  loopback replay/cancellation scenarios directly prove the changed behavior.
  A new monolithic scenario would require test-only orchestration controls and
  would not add material product confidence for this patch.

Parent final review:

- No remaining findings. Retry is opt-in for stable Assistant Ask identities,
  shares one deadline, excludes caller cancellation and non-`5xx` responses,
  and does not change unrelated control requests.

## Deployment

- Web and Cloudflare control-flow change only; no schema, wire-shape, or
  persisted-state change.
- Deploy Cloudflare and roll the runner revision first, then deploy Web. The
  Cloudflare-first compatibility window accepts old Web behavior; Web-first
  would omit the new exact-replay recovery from warm old runners.
Updated: 2026-07-30
Completed: 2026-07-30

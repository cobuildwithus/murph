# Reduce hosted wake reconciliation work

## Outcome and invariants

Reduce avoidable work before a hot conversation wake while preserving durable
Temporal handoff, current access and consent, authoritative usage admission,
custom-funded inference, denied-work notices, and workflow replay ordering.

## Evidence and owner

Bounded production history attributes variable wake delay to the Web facts
activity, with negligible activity queue wait and no retry or timer delay.
The Web facts service reads custom inference concurrently with every usage gate,
but uses that result only for a denied allowance. This adds an unnecessary read
and failure dependency to allowed work. Existing facts-stage callbacks classify
failures but do not measure successful stage duration, leaving the measured
activity delay unpartitioned. Exact private worker source and relevant public
contracts were inspected; removing its facts prerequisite is not safe.

Web remains the canonical facts and usage owner. Temporal remains a pointer-only
scheduler. No new authoritative state, activity command ordering, provider authority,
cache, retry, dependency, configuration, or new service is required.

## Smallest change and proof

- Defer the existing custom inference override read until an allowance denial
  actually requires it. Preserve the mutating usage owner and consent handling.
- Use the existing route stage callback for bounded numeric timing logs, with
  unchanged facts response and error behavior. No private rows or identifiers.
- Prove allowed reconciliation survives an irrelevant override lookup failure;
  preserve denied custom override, denied lookup failure, and revoked consent.
- Exercise timing accumulation, bounded output, and response/error preservation.
- Preserve direct Worker authentication and command durations in the existing
  Web timing callback using optional numeric response headers. Pair these fields
  with that exact direct request instead of the coalesced runtime wake.
- Prove old Workers without headers remain compatible and malformed diagnostic
  values are ignored without changing accepted processing.
- Run focused Web tests, Web typecheck, and authored-code complexity review.
- Complete parent review, required PR review and CI under existing authorization.

## Failure, compatibility, and measurement limits

The denied path still requires the override query and fails closed on its error.
It performs that query after usage admission rather than concurrently. There is
no wire-contract or replay change, so independent Web/worker deployment remains
compatible. Timing is diagnostic only and cannot replace operation results.
Removing a parallel query proves reduced work, not a fixed latency reduction.
Production comparison after a protected release is required for that claim.
The direct Web request's internal delay remains a separate evidence gap; do not
infer transport/authentication durations from merged competing wake traces.

## Progress

- Completed bounded Temporal history, Web request, warm-turn cohort and source audit.
- Implemented denied-only query and both measurements; no added awaits or calls.
- Regression proof failed on the original unused lookup; final focused owner
  runs passed 264 cases. Web, Cloudflare, hosted-execution and control-client
  typechecks passed. Parent source review and complexity guard passed; the
  existing parser and reconciliation hotspots did not gain complexity.
- PR #3087 round 1 passed with no qualifying findings on the pushed candidate.
  The exact-turn capture and response hash match the independently captured
  gpt-6-pro model metadata. The response text self-attested UNKNOWN; acceptance
  uses that exact-response model evidence, confirmed attachment, substantive
  full-snapshot review, and more than 301 seconds of attached response waiting.
  An earlier browser attempt failed before staging and was recovered on another
  existing lane without changing the candidate or completing a review round.
- All candidate CI checks passed. This final plan closure changes documentation
  only; final-head CI and merge remain operational gates. Production deployment
  and observed latency improvement are not claimed by this completed code plan.
- Production latency improvement remains unmeasured; this patch closes the
  request-attribution and facts-stage evidence gaps for the next observation.
Status: completed
Updated: 2026-09-09
Completed: 2026-09-09

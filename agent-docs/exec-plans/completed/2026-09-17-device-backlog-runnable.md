# Distinguish runnable device backlog from scheduled imports

Status: completed
Created: 2026-09-17
Updated: 2026-09-17

## Outcome and protected invariant

Exclude deliberately future-scheduled jobs from the continuous backlog notice.
Preserve checkpoint-fenced stall/cycling detection, failed-pass retry evidence,
foreground priority, and all device scheduling and canonical import behavior.

## Architecture and evidence

The runtime already owns queue availability and retained continuation hints.
Its existing pass diagnostics count all pending work; the Web observation reader
therefore cannot distinguish future jobs from runnable imports. Derive bounded
runnable counts beside those existing counts. Keep the original pending signal
for reliability alerts and reuse the existing checkpoint/continuity evaluator
for the runnable backlog signal. No new state owner, persisted schema, queue,
dependency, provider policy, or extra database query is required.

## Failure and rollout

Only a successful, complete queue observation plus returned continuation can
prove no runnable work remains; failed, missing, malformed, or truncated evidence
keeps the existing conservative pending behavior. An accepted matching checkpoint
must publish the transition. Deploy Web first, then the runner. Old producers
retain old alert behavior; old consumers ignore additive diagnostic counts.
Remove the legacy fallback only after old producers and their two-hour observation
window have drained. Rollback changes alert precision, not import authority.

## Tasks and proof

1. Add synthetic regressions for deferred-only, mixed/due, failed, unknown,
   truncated, checkpoint, and old/new diagnostic behavior.
2. Derive runtime counts and project a separate runnable observation; reuse
   the current evaluator and document the contract in Reliability.
3. Run focused runtime/Web tests, real local PostgreSQL reader proof, relevant
   typechecks, complexity diff, and parent privacy/architecture review.
4. Complete the scoped commit and applicable final review/CI workflow.

## Scope

Operational diagnostics and alerts only. No member-facing behavior or changelog
entry, provider API change, assistant prompt/tool change, production mutation,
or claim that a cleared efficiency notice proves the queue drained.

## Verification

- Runtime maintenance: 129 tests passed, including runnable queue/continuation
  emission through the production diagnostic parser.
- Web evaluator, monitor, and real local PostgreSQL log reader: 57 tests passed.
  SQL proof covers scheduled, queue-due, continuation-due, failed, truncated,
  unavailable, legacy, and malformed observations; overdue-wake stalls survive.
- Assistant-runtime and hosted-Web typechecks passed.
- Complexity diff passed with no increase in debt or maximum complexity.
  Existing lifecycle logging remains at 46; the existing progress diagnostic
  owner carries the new counts. No new database calls or durable state.
- Parent review: retained scheduling, imports, checkpoint ownership, rollout
  compatibility, and privacy preserved. No new production permissions or effects.
- Documentation drift and gardening checks passed; privacy review passed.
  Implementation is complete and ready for the scoped commit. This is a local fix lane;
  no PR, CI, ReviewGPT, merge, or deployment has been performed. A later PR
  requires the routed final ReviewGPT and exact-head CI gates.

Completed: 2026-09-17

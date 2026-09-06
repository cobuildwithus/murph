# Runtime owner-release reconciliation

## Objective

Remove the accepted-processing handoff delay after a completed hosted runtime
owner releases its exact write fence while newer actionable mailbox work is
already durable. Preserve the existing single-owner guarantee and use the
ordinary facts-driven Temporal scheduler without adding a queue, alarm,
persisted flag, or second work owner.

## Proven regression

- A real hosted-local journey submits a signed conversation webhook while a
  default pass is completing model-free system work.
- The Cloudflare runtime completes, clears the exact owner fence, and calls the
  authenticated Web owner-release endpoint.
- Web observes actionable mailbox lag and sends `runtime_recheck_requested`.
- Temporal re-reads the new lag but intentionally preserves the accepted
  default owner's recommended recheck horizon because a generic facts-only
  signal cannot prove that owner has stopped.
- The journey therefore sees no second provider request within the foreground
  reply budget and remains parked in `runtime_wake_recheck`.
- The same real journey fails on public `main` and the exact head of PR #2679,
  proving that PR fixes an adjacent projection livelock but not this handoff.

## Root cause and design

The owner-release callback is the existing authority that knows the accepted
runtime owner is gone, but that fact is erased when Web maps the callback to a
generic facts-only recheck. Bind the callback to its opaque runtime attempt in
the signed query and represent it with one new pointer-only
`runtime_owner_released` Temporal signal.

The private workflow will match that signal to the accepted runtime attempt in
workflow-local ephemeral state. An exact match invalidates the
accepted-processing hold; a stale release cannot affect a newer owner. Normal
fresh reconciliation facts then select default, retention, or model-free
system work. The signal must not set `runtimeWakeRequested`, append mailbox
work, persist state, or claim a provider pass. Generic rechecks retain their
current duplicate-owner protection, and provider-setting wakes retain their
current default-pass semantics.

## Product UX scope

Affected person: a member who sends a message during the final checkpoint and
owner-release window of an accepted background/default pass. Their message
should receive the ordinary foreground response immediately after the prior
owner releases, rather than waiting for the prior owner's retry horizon.

No copy, UI, billing, auth, or mailbox ordering behavior changes. Failure to
deliver the best-effort owner-release signal retains the existing durable
reconciliation horizon.

## Implementation

1. Add the exact-attempt pointer signal to the public hosted-execution contract
   and parser, plus a narrow Web signaling helper used only by the authenticated
   owner-release route.
2. Add a private deterministic workflow regression that accepts one default
   pass, receives newer conversation lag plus owner release, and requires the
   next default pass before the accepted horizon.
3. Teach the private workflow to invalidate only the stale accepted-owner hold
   on the new signal while preserving all existing no-progress/fairness state.
4. Update the durable runtime, security, reliability, and deployment contracts
   to distinguish owner release from facts-only rechecks and provider wakes.
5. Run focused contract, route, workflow, typecheck, and replay-safety checks,
   then rerun the real hosted-local journey against the private worker package.

## Rollout and rollback

Deploy the private Temporal consumer before public Web can emit the new signal,
then deploy Web before Cloudflare adds the signed attempt query. Web temporarily
maps legacy callbacks without an attempt pointer to the old generic recheck for
mixed-version safety. During rollback, reverse that producer order and keep the
private consumer compatible until Web no longer emits the signal. Callback or
signaling failure continues to fall back to durable reconciliation.

## Completion evidence

- The focused private exact-owner regression was red before the workflow
  change: the second execution remained at the accepted owner's 120-second
  horizon. The exact-release case is green after the change, while the stale
  release case still preserves that horizon.
- Public hosted-execution tests pass (572), Web route and signal tests pass
  (99), Cloudflare owner-release tests pass, and the hosted-local harness suite
  passes (449, with one expected skip).
- The private package's full required verification passes: typecheck, 764
  workflow tests, coverage thresholds, production workflow bundle, and seven
  built-worker compatibility tests.
- The real hosted-local journey passes through signed Web ingress, durable
  mailbox lag, Temporal acceptance, exact Cloudflare owner release, a
  replacement runtime, provider request, outbound reply, and final idle state.
  It failed on public `main` and the exact head of PR #2679 before this fix.
- Both repository diffs pass whitespace and direct-identifier privacy checks.
Status: completed
Updated: 2026-09-01
Completed: 2026-09-01

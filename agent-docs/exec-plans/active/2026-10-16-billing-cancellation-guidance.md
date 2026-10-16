# Explain scheduled cancellation when a plan change is blocked

Status: active
Created: 2026-10-16
Updated: 2026-10-16

## Goal and protected invariant

Explain why a scheduled cancellation prevents a plan change and provide an
honest next step. Preserve Stripe-owned cancellation and all current admission,
authority, scheduling, HTTP status, diagnostic code, and mutation behavior.

## Evidence and owner

The existing service passes the fixed reason `cancellation` to the unsupported
subscription-state error, but its generic message discards that useful reason.
The settings client displays that message directly. Synthetic subscriptions
with either `cancel_at` or `cancel_at_period_end` expose the gap. The correction
belongs in the existing service error builder; no new state or abstraction is
needed. Independent live records support relevance but remain private.

## Product UX

- Outcome: A member understands that cancellation blocks scheduling a plan change.
- Entry and promise: Confirm a scheduled plan change in Settings; a rejection
  explains cancellation and directs the member to support if they want a change.
- Reaches: Both scheduled cancellation forms. Other unsupported states keep their
  current message; ordinary supported changes keep their existing behavior.
- Proof: Synthetic service rejection, unchanged diagnostic contract and zero
  billing writes, plus route/client error propagation and existing happy paths.
- Done when: The explanation reaches the existing error display without claiming
  that cancellation was undone or that every portal configuration can undo it.

## Scope and decisions

Use ReviewGPT to prepare the narrow source and regression patch. No new Stripe
reads or writes, cancellation reversal, portal/config changes, telemetry, schema,
retries, or production mutations. This is a functional guidance correction and
must remain ready for human merge. The canonical error code and 409 remain.

## Tasks

1. Capture implementation; prove cancellation tests fail on original source.
2. Apply and inspect the minimal patch; prove both cancellation forms, unchanged
   generic guidance, no writes, and supported plan changes.
3. Add a focused changelog item; run Web checks and parent Product UX review.
4. Commit, open draft PR, read back evidence, launch final ReviewGPT and exact-head
   CI on the stable candidate, then leave the functional PR for human merge.

## Verification

Baseline: billing plan-switch, projection-store, and vault-share delivery tests
passed (120 tests) after preparing the generated Prisma client. The projection
proof belongs to the read-only sweep and is not a change in this PR.
Final patch, failure-before proof, typecheck, final review and CI pending.

## Risks and mitigations

Do not suggest that an arbitrary cancellation can be reversed in the portal.
Use the existing support escalation, with no automatic billing operation.
Old/new Web versions differ only in message text; no deployment sequencing or
persisted-state compatibility change. Production outcome remains unverified
until a human merges and deploys the functional change.

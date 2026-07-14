# PR 606 ReviewGPT Round 1 Repairs

## Objective

Triage and resolve the four High-severity findings from ReviewGPT round 1 on
PR 606 without weakening the authorization boundaries restored by the PR.

## Findings To Prove

1. Legacy current-route handling must not authorize a copied model-supplied
   route or infer authority from model-writable timestamps or runtime evidence.
2. Group actor filtering must not advance a shared channel cursor past an
   excluded member's earlier input.
3. Legacy Family owner migration must not overwrite newer owner-scoped billing
   ciphertext from a snapshot read before the group ownership lock.
4. Checkout compensation must persist one event-owned obligation and refund
   the checkout's causal initial invoice rather than mutable `latest_invoice`.

## Constraints

- Accept a finding only after proving a production-faithful path in current code.
- Prefer deletion, ordering, and existing owner locks over new lifecycle machinery.
- Keep model-supplied targets fail-closed when durable automation-linked authority
  cannot be proven.
- Preserve pending inputs, Stripe causal identity, encryption-owner consistency,
  stale-event ordering, and idempotent retry semantics.

## Completion

- Add focused regression proof for each accepted finding.
- Run affected owner tests/typechecks and required exact-diff completion audits.
- Commit through `scripts/finish-task`, push the new PR head, and immediately run
  ReviewGPT round 2 alongside the new CI run.

## Resolution

1. Delete automatic legacy route projection. The persisted record has no
   trustworthy provenance field that can distinguish a pre-marker current-route
   write from model-supplied data, so every unmarked route remains fail-closed
   until the intended conversation edits or reactivates it through the trusted
   current-route bridge. This rule applies uniformly to canonical and
   device-activity schedules.
2. Treat the first different group actor on a delivery route as an ordering
   barrier. Neither route fallback nor strict-conversation results may admit or
   advance past that cursor; the next actor-scoped turn retains ownership.
3. Serialize Family migration, billing writes, checkout issuance, and invite
   issuance/acceptance on the group row, then reload owner and billing state
   and revalidate the event's checkout/subscription binding under that lock
   before stale-event checks or owner-scoped re-encryption.
4. Persist the accepted checkout compensation on the Stripe event receipt using
   blind indexes for the event-owned subscription and causal initial invoice.
   Resolve a nullable Checkout Session invoice from the unique
   `subscription_create` invoice at or before the event time, refund that exact
   invoice, and let retries finish the accepted obligation without recomputing
   owner eligibility.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13

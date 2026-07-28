# PR 1052 terminal sponsorship recovery

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

Resolve ReviewGPT round 8's merge-induced group sponsorship recovery finding
without adding payment state, a new lifecycle owner, or another provider path.

## Proven gap

An exact request-key replay checks the submitted sponsorship draft before it
projects a terminal purchase. After a remount loses the frozen draft, that
ordering turns an already terminal purchase into a permanent request-key 409
loop, so the browser cannot clear the durably matched request identity.

## Invariants

- A live `created`, `checkout_open`, or `payment_pending` purchase keeps its
  frozen sponsorship authorization and rejects a changed draft.
- A terminal purchase never starts provider work and may safely acknowledge the
  exact request-key match while explaining that new sponsor details were not
  applied.
- A `created` purchase whose checkout deadline has passed is closed through the
  existing purchase-expiry owner before it is projected.
- Stripe reconciliation and the existing purchase row remain the only payment
  and ambiguity authorities.

## Tasks

1. Make the exact-key recovery path status-aware using the existing expiry and
   sponsorship owners.
2. Generalize the existing offer-conflict projection to distinguish amount and
   sponsorship selection conflicts in the client copy.
3. Add service and real dialog regressions for active, terminal, and remount
   recovery behavior.
4. Run focused and canonical verification, push the remediation, and obtain a
   ReviewGPT correction-round pass with exact-head CI green.

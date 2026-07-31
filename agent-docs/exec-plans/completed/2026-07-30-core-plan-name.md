# Core plan name

## Outcome

Rename the eligible $3.50/month direct member plan from Group to Core everywhere
members see or hear the plan name, while preserving the existing Group product
concepts, billing SKU, eligibility, Stripe reconciliation, allowance, and
runtime behavior.

## Protected invariants

- `launch_group_monthly` remains the internal billing code and configured Stripe
  Price identity.
- The plan remains available only to confirmed Murph group members and continues
  to map to the existing `pulse` runtime capability.
- Public checkout continues to expose only Pulse and Edge.
- Group conversations, membership, challenges, funding, sponsorship, and other
  domain concepts keep their existing Group terminology.
- One shared presentation constant remains the source for the member-facing plan
  display name.

## Smallest complete implementation

1. Inventory plan-name presentation strings and separate them from Group domain
   language and internal identifiers.
2. Change the canonical display name to Core and update direct plan-specific
   Settings, assistant, test, design-catalog, and current product-document copy.
   Teach the private assistant's billing instruction owner that Core maps to
   `launch_group_monthly`.
3. Preserve the legacy `Group` wire literal and translate it at existing Web and
   assistant presentation boundaries. Add no state, billing branch, protocol
   change, or deployment configuration.
4. Prove eligible, current, pending, and payment-recovery presentations still
   describe the same plan behavior under the Core name.
5. Complete focused verification, rendered desktop/mobile evidence, the routed
   product/frontend review, exact-head CI, merge, and worktree retirement.

## Failure and rollback

- A missed presentation string would create mixed Group/Core naming, so stale
  member-facing plan-name searches and focused state tests are part of proof.
- The change is presentation-only. Web and Cloudflare can roll independently
  because the wire contract does not change. No Stripe, database, or runtime
  migration is required.

Status: completed
Updated: 2026-07-30
Completed: 2026-07-30

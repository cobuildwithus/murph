# fund-groups-at-any-capacity

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Let an eligible participant open the group funding surface and explicitly
  start monthly sponsorship or make a one-time contribution regardless of the
  chat's current capacity.

## Success criteria

- Unsponsored active groups expose a funding URL at healthy, low, and exhausted
  capacity.
- An explicit group-funding request may use that returned URL independently of
  low-capacity urgency, including for an already sponsored room's additional
  one-time contribution.
- The funding page offers monthly sponsorship at every valid capacity.
- Monthly activation retains the existing explicit exact-$5 purchase,
  authenticated payer, one-sponsor, fixed-cap, and webhook-grant contracts.
- Automatic refills remain admitted only at low or exhausted capacity.
- Focused service, page, and group-tool projection tests cover the corrected
  behavior, and the real production components remain represented in the
  design catalog.

## Scope

- In scope:
  - Group funding-link projection.
  - Monthly activation eligibility and funding-page presentation.
  - Hosted assistant follow-up policy for explicit funding requests.
  - Durable architecture/product documentation and focused regression tests.
- Out of scope:
  - Refill admission, refill dispatch, Stripe reconciliation, credit balances,
    one-time offer amounts, or multi-sponsor behavior.

## Constraints

- Technical constraints:
  - Keep `HostedUsageCreditEntry` as the only balance owner and
    `HostedUsageCreditPurchase` as the only purchase owner.
  - Preserve authenticated server-owned payer, beneficiary, offer, and cap
    authority.
  - Do not weaken the low/exhausted automatic-refill gate.
- Product/process constraints:
  - Treat capacity as urgency, not purchase eligibility.
  - Keep the room free of payer, cap, charge, depletion, and refill detail.
  - Reuse the existing funding page, dialogs, Stripe paths, and design study
    without a new state owner or abstraction.

## Risks and mitigations

1. Risk: Removing the wrong capacity check could permit unnecessary automatic
   charges.
   Mitigation: Remove capacity coupling only from explicit activation and link
   presentation; retain the refill admission check and its tests unchanged.
2. Risk: A stale assistant projection could still hide the funding link.
   Mitigation: Project the URL independently from `fundingNeeded`, teach the
   hosted low-usage skill that the boolean controls urgency only, and cover a
   healthy unsponsored group directly.
3. Risk: A direct link could widen financial authority.
   Mitigation: Keep the existing app-session, target revalidation, server-owned
   offer/cap, explicit action, and Stripe reconciliation boundaries unchanged.

## Tasks

1. Separate funding availability from capacity urgency in the group status
   projection.
2. Remove the healthy-capacity gate from explicit monthly activation while
   retaining group-target and active-runtime validation.
3. Present the existing monthly sponsorship dialog for every valid unsponsored
   group and align the design study and durable docs.
4. Update assistant follow-up policy so an explicit funding request may use a
   returned link at any capacity without creating an unsolicited funding nudge.
5. Add focused projection, page, purchase-service, and assistant-policy
   regressions.
6. Run focused tests, typecheck, browser proof, required reviews, and exact-head
   PR checks.

## Decisions

- Capacity state controls automatic refill timing and urgency messaging only.
- A monthly sponsorship activation remains an immediate exact-$5 purchase, so
  the newly added credit is useful even when included capacity is currently
  healthy and carries forward if unused.
- No new endpoint, model, table, queue, balance, or payment primitive is needed.

## Verification

- Commands to run:
  - Focused hosted-Web Vitest files for group status, funding page, purchase
    service, and refill admission.
  - Focused assistant-skill and hosted-execution parser regressions.
  - Hosted-Web typecheck and frontend-design-proof.
  - Desktop and mobile design-catalog browser proof.
  - Required preliminary specialist, final ReviewGPT, Claude UI, and exact-head
    GitHub Actions gates.
- Expected outcomes:
  - Healthy unsponsored groups expose and can use the monthly sponsorship path.
  - Low/exhausted automatic refill behavior is unchanged.

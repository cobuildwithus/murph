# Group member plan current-main port

## Outcome

Ship the smallest complete direct Group subscription on current `main`: a
confirmed Murph group member can privately choose the $3.50/month Group plan
after the existing free Pulse trial, and Stripe, Settings, usage accounting,
and the private assistant all agree on that billing SKU.

## Protected invariants

- `apps/web` remains the sole billing, eligibility, usage, and Stripe
  reconciliation owner.
- Group maps to the existing `pulse` runtime capability. It adds no entitlement
  tier, membership flag, schema table, group wallet, or wearable rule.
- Confirmed canonical group membership gates each new Group selection. Pending
  membership does not qualify, and leaving a final group does not silently
  cancel an already active Group subscription.
- Exhausting personal AI allowance blocks only new usage-bearing model work.
  Active access, wearable ingestion and reconciliation, storage, and authorized
  group projections continue.
- Public signup and invite checkout continue to expose only Pulse and Edge.
- Stripe Customer, Subscription, invoice, webhook, billing lock, and
  reconciliation owners remain canonical. Browser or assistant state never
  grants entitlement.
- Conversation and Settings paths call the same server-owned billing policy and
  require explicit confirmation before an immediate charge.

## Current owners and evidence

- `billing-plans.ts` owns direct SKU definitions and price-derived allowance.
- `HostedGroupMember` is the canonical membership evidence.
- Existing immediate plan-change, period-end schedule, and Pulse-trial
  activation services own Stripe transitions.
- Existing usage-status and subscription tool projections own private
  explanation and action.
- PR #1029 proves the intended Group policy, but its abandoned parent branch is
  not merge authority. Port only behavior that fits current owners.

## Smallest complete implementation

1. Add Group to the private direct billing catalog with an explicit Pulse
   default SKU so runtime capability is never inverted into billing identity.
2. Add one read-only confirmed-membership eligibility resolver and reuse it in
   every private Group offer or mutation.
3. Generalize the existing plan-change and period-end schedule services just
   enough for Group, Pulse, and Edge transitions; preserve historical
   Pulse-specific compatibility entrypoints as thin delegates where current
   callers still use them.
4. Let the existing Pulse trial continue into Group at trial end. Keep
   immediate Group conversion out of the ordinary active-trial path; use it
   only when trial access can no longer continue, and require exact-price
   confirmation.
5. Reconcile Group by configured Stripe Price and give it the catalog-derived
   $2.80 monthly included AI allowance.
6. Expose the eligible choice in the authenticated Settings billing card and
   the existing private subscription tool, backed by the same server policy.
7. Add the real billing card state to the design catalog and focused regression
   proof for eligibility, transitions, public exclusion, reconciliation,
   usage/exhaustion semantics, and private actions.
8. Update current billing/product owner docs and deployment requirements.

## Deliberately excluded

- No Group-specific trial.
- No public discounted-plan advertisement beyond the already-landed Clubs FAQ.
- No Group-specific personal usage-credit top-up.
- No automatic plan selection from membership or conversation history.
- No new trial-ending notification or scheduler in this port unless a focused
  failure proves the core continuation path cannot work without it.
- No replay of the closed Stripe-hardening parent branch.

## Failure, rollback, and deployment

- Missing or invalid Group Price configuration makes Group unavailable for new
  selection and does not affect current Pulse or Edge paths.
- Stale membership, quote, billing state, or Stripe state fails closed before
  mutation.
- Web owns the new policy and Cloudflare/assistant consume its strict action
  contract. Deploy compatible Web first, then the runtime, or deploy them
  together if the finalized contract is not backward compatible. Roll back the
  runtime before Web.
- Configure and validate the recurring Group Stripe Price before exposing the
  plan in production.

## Proof

- Focused Web, hosted-execution, assistant-engine, and Cloudflare tests for the
  touched owners.
- Authenticated Settings desktop/mobile design-catalog render.
- Direct local Stripe-shape and eligibility scenarios.
- Product-experience review, preliminary completion-specialists ReviewGPT,
  parent final review, exact-head CI, and final ReviewGPT.

Status: active
Updated: 2026-07-29

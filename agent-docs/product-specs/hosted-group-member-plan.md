# Hosted Group Member Plan

Last verified: 2026-07-29
Status: Implemented current-state contract

## Product Contract

Group is a private direct subscription for a person who participates in a
hosted Murph group:

- recurring price: $3.50/month;
- included personal AI usage: $2.80/month, derived by the standard 80% rule;
- runtime capability: the existing Pulse tier;
- access: available only to a confirmed current group owner or joined member;
- trial path: an active direct Pulse trial may continue into Group at its
  natural end;
- public visibility: omitted from public signup and invite checkout.

Group is a personal subscription. It does not fund the group, pool usage,
change group membership, or create a new runtime entitlement. Group funding
continues to use the separate group usage-credit flow.

When Group's personal AI allowance and purchased personal credit are exhausted,
new personal usage-bearing model work pauses. Hosted access, wearable sync and
reconciliation, stored data, and authorized group projections continue.

## Ownership

`apps/web` remains the only owner of billing catalog, eligibility, signed
quotes, Stripe mutations, allowance calculation, and reconciliation.
`HostedGroupMember` is the canonical eligibility evidence. A qualifying row is
current and either owner-shaped or has a confirmed `joinedAt`.

Eligibility is checked when Group is displayed and again inside the member's
billing mutation lock immediately before Stripe access. Losing the last
qualifying membership does not cancel an already active paid subscription, but
it prevents a new Group selection.

Group has its own Stripe recurring Price and direct billing code,
`launch_group_monthly`. It maps explicitly to the existing `pulse` runtime
plan. Runtime capability must never be inverted to infer the direct billing
SKU because Pulse and Group intentionally share that capability.

## Selection And Transitions

Settings and the private subscription tool consume the same server policy.
The supported transitions are:

- active Pulse trial to Group at trial end;
- paid Group to Pulse or Edge immediately;
- paid Pulse to Group at renewal;
- paid Pulse to Edge immediately;
- paid Edge to Pulse or Group at renewal.

An immediate change requires a short-lived signed quote that binds the member,
action, target plan, exact current catalog price, timing, expiry, and current
billing-state fingerprint. The mutation verifies the quote before claiming the
accepted private input or contacting Stripe. A recommendation is never
confirmation.

Scheduled changes use a Stripe Subscription Schedule. The current phase keeps
the source recurring Price until the existing period or trial ends; the future
phase contains only the target recurring Price. Murph stores only the Stripe
schedule id, target plan, and effective time as a pending display projection.
Current entitlement and allowance change only through normal Stripe
reconciliation after the target phase applies.

Public checkout accepts only the explicit public billing-code allowlist. Adding
Group to the private catalog must not make it publicly selectable.

## Failure And Recovery

- Missing or invalid Group Price configuration hides new Group selection
  without affecting Pulse or Edge.
- Stale membership, quote, local billing state, Stripe customer, subscription,
  subscription items, or schedule shape fails closed.
- The same accepted-input action and quote may replay idempotently; a conflicting
  action requires new accepted member input.
- Unknown or foreign Stripe schedules are not reinterpreted or overwritten.
- Group does not support personal usage-credit top-ups while it is the active
  plan.

## Deployment

Configure `HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_GROUP_MONTHLY` with the
recurring $3.50 Stripe Price before exposing Group in production.

Deploy Web first and wait for all Web instances to be current. Web owns the
additive catalog, eligibility, quote, mutation, reconciliation, and callback
contracts. Then deploy Cloudflare so the runtime can request a target plan and
carry the expanded private action contract. Roll back Cloudflare before Web.

After deployment, verify an eligible trial member can see and schedule Group,
an ineligible member cannot select it, public checkout rejects the private
code, and Stripe reconciliation reports the Group SKU with a $2.80 allowance.

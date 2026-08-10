# Hosted Core Member Plan

Last verified: 2026-07-30
Status: Implemented current-state contract

## Product Contract

Core is a private direct subscription for a person who participates in a
hosted Murph group:

- recurring price: $3.50/month;
- included personal AI usage: $2.80/month, derived by the standard 80% rule;
- runtime capability: the existing Pulse tier;
- access: available only to a confirmed current group owner or joined member;
- trial path: an active direct Pulse trial may continue into Core at its
  natural end;
- public visibility: omitted from public signup and invite checkout.

Core is a personal subscription. It does not fund the group, pool usage,
change group membership, or create a new runtime entitlement. Group funding
continues to use the separate group usage-credit flow.

When Core's personal AI allowance and purchased personal credit are exhausted,
new personal usage-bearing model work pauses. Hosted access, wearable sync and
reconciliation, stored data, and authorized group projections continue.

## Ownership

`apps/web` remains the only owner of billing catalog, eligibility, signed
quotes, Stripe mutations, allowance calculation, and reconciliation.
`HostedGroupMember` is the canonical eligibility evidence. A qualifying row is
current and either owner-shaped or has a confirmed `joinedAt`.

Eligibility is checked when Core is displayed and again inside the member's
billing mutation lock immediately before Stripe access. Losing the last
qualifying membership does not cancel an already active paid subscription, but
it prevents a new Core selection.

Core has its own Stripe recurring Price and the internal direct billing code
`launch_group_monthly`. It maps explicitly to the existing `pulse` runtime
plan. Runtime capability must never be inverted to infer the direct billing
SKU because Pulse and Core intentionally share that capability. Hosted wire
schemas retain the legacy `Group` display literal for rolling-deploy
compatibility; Web and assistant presentation boundaries project that internal
value as `Core`.

Core's configured Price id must be distinct from every established direct
plan. Before Web exposes a new selection, signs a quote, or mutates Stripe, it
retrieves the target Price and verifies that it is active, USD-only, fixed
per-unit, licensed, monthly, and equal to the catalog amount. Environment
configuration alone is not proof of the price a member accepted.

## Selection And Transitions

Settings and the private subscription tool consume the same server policy.
Settings plan cards are the sole Settings owner of plan-change actions; the
usage band may expose usage top-ups and legacy bounded actions, but it must not
duplicate `change_plan` controls from the usage projection.
The supported transitions are:

- active Pulse trial to Core at trial end;
- paid Core to Pulse or Edge immediately;
- paid Pulse to Core at renewal;
- paid Pulse to Edge immediately;
- paid Edge to Pulse or Core at renewal.

A private-conversation change requires a short-lived signed quote that binds
the member, action, target plan, exact current catalog price, timing, expiry,
and current billing-state fingerprint. The mutation verifies the quote before
claiming the accepted private input or contacting Stripe. Immediate Settings
changes send the current displayed plan as an expected source token. The
service compares that token under the member billing-mutation lock before any
Stripe mutation. A recommendation is never confirmation.

One member billing-mutation lock owns the complete direct-plan change:
authoritative source-plan read, eligibility and provider-Price validation,
Stripe mutation, and local reconciliation. A concurrent conflicting selection
therefore observes the winning plan and fails stale instead of applying a
second change. An exact same-target retry remains idempotent.

Scheduled changes use a Stripe Subscription Schedule. The current phase keeps
the source recurring Price until the existing period or trial ends; the future
phase contains only the target recurring Price. Murph stores only the Stripe
schedule id, target plan, and effective time as a pending display projection.
Current entitlement and allowance change only through normal Stripe
reconciliation after the target phase applies.

An active trial remains scheduled to end at its original Stripe trial boundary
even when its included AI allowance is exhausted. Core-at-trial-end requires
a usable subscription payment method before Murph creates or updates a
schedule. If payment setup is needed, Web opens the payment-method flow and
requires a fresh plan choice after return; it does not retain a Core mutation
intent that could be applied against changed billing state. The locked
Pulse-trial state, rather than an optional caller hint, owns both the payment
method preflight and the requirement that Stripe itself still report
`trialing`. Admission and those guards share the same resolver, including the
brief reconciliation window where the retained Pulse-trial offer is canonical
but the phase projection is still null. A local-trial/provider-paid race fails
stale instead of scheduling one paid cycle late.

A paused Pulse-trial recovery claims its provider transition with one
deterministic key that is independent of the selected paid target. The request
body carries the exact Pulse or Core choice. Exact same-target retries replay
the claim, while a different target conflicts before Stripe resume and returns
the existing stale-choice recovery. While invoice confirmation is pending,
Settings and assistant offers keep the existing exact status-check actions
available instead of reducing recovery to a generic billing-portal link.

Public checkout accepts only the explicit public billing-code allowlist. Adding
Core to the private catalog must not make it publicly selectable.

## Failure And Recovery

- Missing, duplicate, unreachable, inactive, or catalog-mismatched Core Price
  configuration hides new Core selection without affecting Pulse or Edge and
  fails closed again at quote and mutation boundaries.
- Settings bounds its display-only provider Price read to five seconds with no
  network retry. Failure hides Core while the rest of Settings remains
  available; quote and mutation boundaries keep their stronger validation.
- Stale membership, quote, local billing state, Stripe customer, subscription,
  subscription items, or schedule shape fails closed.
- A cardless Core-at-trial-end choice does not create a schedule. Payment
  setup returns the member to neutral Settings or conversation context for a
  fresh exact-price choice.
- The same accepted-input action and quote may replay idempotently; a conflicting
  action requires new accepted member input.
- Unknown or foreign Stripe schedules are not reinterpreted or overwritten.
- Core does not support personal usage-credit top-ups while it is the active
  plan.

## Deployment

Configure `HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_GROUP_MONTHLY` with the
recurring $3.50 Stripe Price before exposing Core in production.

The naming change preserves the existing Web/Cloudflare wire contract, so Web
and Cloudflare may roll independently. Deploy both to make every member-facing
surface say Core; neither deployment changes billing behavior or Stripe state.

After deployment, verify an eligible trial member can see and schedule Core,
an ineligible member cannot select it, public checkout rejects the private
code, and Stripe reconciliation reports the internal Group SKU with a $2.80
allowance while member-facing Web and assistant surfaces say Core.

# Hosted Core Member Plan

Last verified: 2026-08-10
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

A paused Pulse-trial recovery commits `incomplete`, its exact Pulse-or-Core
target, and the validated claim-time Stripe Price id to the existing member
billing reference under the member lock before opening payment setup or
mutating Stripe. That database projection, rather than mutable catalog
configuration or Stripe's bounded idempotency cache, owns the first selected
terms. Provider cleanup keys include the bound Price. Exact same-target retries
recover the claim with that Price even after the catalog points at a replacement
Price, while a different target conflicts before provider access and returns
the existing stale-choice recovery. A concurrent change to the bound Price also
fails closed under the member lock. Subscription receipts preserve the
claim while invoice confirmation remains incomplete. Invoice settlement must
contain the bound Price on both the target subscription and invoice, so neither
an older Pulse invoice nor a later catalog Price can activate Core (or vice
versa). Settings and assistant offers expose only that exact status-check action
instead of another plan choice or a generic billing-portal link. The status
dialog does not present the mutable current catalog amount as though it were the
already accepted amount. Web immediately refreshes the canonical billing
projection when the request reports pending, and closing the confirmation
preserves the exact status-check action; the close control does not claim to
cancel provider work. The locked retry proceeds only while the customer and
subscription binding is unchanged and the source is the exact incomplete
target or the original active-trial/paused subscription. The same paid target
is idempotently complete, while another paid target, suspension, or terminal
state wins before provider access. The claim has no automatic expiry: Murph
cannot prove that an interrupted request did not already mutate the provider,
so releasing it on a timer would reopen the direct-versus-Family charge race.

Core membership eligibility is required when the first locked selection
creates the claim. Later membership loss does not revoke an exact incomplete
claim, just as it does not cancel active Core: same-target retries remain
recovery and skip new-selection admission while preserving suspension,
binding, Family-authority, terminal-state, paid-target, and conflicting-target
guards. After a rejected request, Web preserves its accessible error and
refreshes the canonical projection. A marked payment-method return for an
exact incomplete Core claim points to Check Core status; fresh-choice wording
remains limited to active-trial returns where no target claim exists. An exact
incomplete Pulse claim is labeled `Billing pending`, never `Free trial`.

Public checkout accepts only the explicit public billing-code allowlist. Adding
Core to the private catalog must not make it publicly selectable.

## Failure And Recovery

- Missing, duplicate, unreachable, inactive, or catalog-mismatched Core Price
  configuration hides new Core selection without affecting Pulse or Edge and
  fails closed again at quote and mutation boundaries.
- Settings bounds its display-only provider Price read to five seconds with no
  network retry. Failure hides Core while the rest of Settings remains
  available; quote and mutation boundaries keep their stronger validation.
- Stale membership before the first Core selection, quote, local billing state,
  Stripe customer, subscription, subscription items, or schedule shape fails
  closed. Membership loss after an exact claim does not revoke its recovery.
- A cardless Core-at-trial-end choice does not create a schedule. Payment
  setup returns the member to neutral Settings or conversation context for a
  fresh exact-price choice.
- The same accepted-input action and quote may replay idempotently; a conflicting
  action requires new accepted member input.
- Unknown or foreign Stripe schedules are not reinterpreted or overwritten.
- Core does not support personal usage-credit top-ups while it is the active
  plan.

## Deployment

Apply the nullable `pulse_trial_paid_claim_price_id` database migration before
deploying Web code that creates or recovers paid-trial claims. The prior Web
version ignores the additive column, so this order preserves a safe rolling
window; deploy the new Web version immediately afterward to ensure every new
claim binds its accepted Price.

Configure `HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_GROUP_MONTHLY` with the
recurring $3.50 Stripe Price before exposing Core in production.

The naming change preserves the existing Web/Cloudflare wire contract, so Web
and Cloudflare may roll independently. Deploy both to make every member-facing
surface say Core; neither deployment changes billing behavior or Stripe state.

After deployment, verify an eligible trial member can see and schedule Core,
an ineligible member cannot select it, public checkout rejects the private
code, and Stripe reconciliation reports the internal Group SKU with a $2.80
allowance while member-facing Web and assistant surfaces say Core.

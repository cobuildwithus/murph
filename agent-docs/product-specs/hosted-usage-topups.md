# Hosted Usage Top-Ups

Status: Proposed target state
Last verified: 2026-07-16

## Decision

Use Stripe-hosted Checkout to collect a one-time payment and a Murph-owned,
append-only usage-credit ledger to decide who receives the usage and how it is
consumed.

The initial individual-plan offer is:

| Offer code | Checkout subtotal | Usage credit granted |
| --- | ---: | ---: |
| `usage_5_usd` | $5 USD | $5 of Murph usage credit |
| `usage_10_usd` | $10 USD | $10 of Murph usage credit |
| `usage_25_usd` | $25 USD | $25 of Murph usage credit |

The cash subtotal and granted usage value are separate versioned facts even
when the initial conversion is one-for-one. One dollar of v1 usage credit is
one dollar of capacity under Murph's existing cost-weighted AI usage meter. It
is not a token count, bank balance, Stripe customer balance, subscription
invoice credit, transferable asset, or promise of cash redemption.

Stripe proves money movement. `apps/web` remains authoritative for the payer,
beneficiary, offer, grant, available usage credit, consumption, refund
adjustments, and future group authorization.

## Existing Enforced Usage Boundary

Hosted included-usage exhaustion already blocks subsequent usage-bearing work.
Top-ups extend the capacity evaluated by that enforced boundary; they do not
introduce a second admission owner or a second exhaustion policy.

1. Active subscription or sponsored entitlement remains the prerequisite for
   service. Credit never creates or extends entitlement.
2. Current-period included allowance is used first.
3. Purchased usage credit is used next.
4. When neither is available, the existing usage-limit block remains in force.
   Accepted conversation input stays durable and pending rather than being
   silently dropped or converted into a second terminal policy.
5. A request admitted before its usage crosses the boundary may finish. Later
   usage-bearing work observes the settled exhausted state, so the product must
   not promise an exact token-level cutoff.
6. A fulfilled top-up makes effective capacity positive and triggers the
   existing runtime recheck so pending accepted work can resume without waiting
   for the next monthly reset.

No Stripe request belongs on the model-start or reply critical path. The
existing gate reads only Murph's local durable effective-capacity projection:
included capacity remaining plus eligible purchased credit remaining.

### Source-State Reconciliation

The checked-out source currently contains an advisory allowance branch, tests,
and copy that conflict with the enforced product behavior confirmed for this
spec. Before implementing top-ups, reconcile that source-state discrepancy and
identify the single deployed usage-gate owner, blocked-input disposition,
reset/retry behavior, and route-specific notice. Restore or extend that one
owner; do not preserve the discrepancy by adding a second gate. This is a
current-source correction, not a new product-policy prerequisite for top-ups.

## Product Outcome

An eligible paid Pulse or Edge member can:

1. See included usage in its existing percentage presentation.
2. Open a small **Add usage** dialog over Settings.
3. Choose $5, $10, or $25 without a preselected or promoted option.
4. Continue to Stripe-hosted Checkout.
5. Return to Settings with an honest pending state while webhook fulfillment
   completes.
6. See a separately labeled usage-credit amount after the verified grant.
7. If usage was blocked, have pending accepted work become runnable after the
   verified grant restores capacity.
8. Continue using that credit after an included-usage reset until the credit is
   consumed.

The same primitive can later credit a synthetic group-container member while a
different personal member pays. Group funding does not require a second balance
system or a polymorphic usage-account service.

## Individual MVP

### Eligibility

The first release permits purchases only when all of these are true:

- the browser has a current authenticated hosted app session;
- the beneficiary is that same direct personal member;
- hosted access is active and not suspended;
- the member has a paid Pulse or paid Edge subscription;
- the member has one canonical existing Stripe Customer binding; and
- the selected offer is active in the server-owned catalog.

Pulse Trial keeps **Start Pulse** rather than selling top-ups. Sponsored Family
members are excluded because their payer and beneficiary already differ and
belong with the later sponsored/group funding policy. Cancellation, past-due,
suspension, malformed billing state, and an expired trial fail closed.

Purchased credit does not expire in v1. It survives monthly allowance resets
and a subscription cancellation, but it is usable only after an eligible plan
is active again. It cannot be transferred between members or applied to a
subscription invoice.

### Presentation

Included usage remains the existing bounded percentage. Buying credit must not
make that percentage move backward or expose the internal dollar value of a
plan's included allowance.

Purchased value appears separately, for example:

- `100% of included usage used`
- `$8.42 usage credit remaining`

The value is rounded down for display to whole cents while accounting stays in
integer USD micros. Copy must call it **usage credit**, never cash, wallet
funds, account balance, or refundable dollars.

Settings may show a quiet **Add usage** action at any utilization for an
eligible paid member. Home and assistant surfaces should surface the action
only when the current forecast predicts exhaustion, at least 80% of included
usage is used, or included and purchased capacity is exhausted. Pulse's Edge
upgrade remains available through the plan card instead of creating a
multi-action usage contract.

### Settings Dialog

`PlanUsageBand` remains the surface owner. Add one client leaf using the
existing `Dialog`, `RadioGroup`, `ChoiceCard`, and `PaymentButton` primitives;
do not add a generic payment-modal framework.

The target composition is:

- Title: **Add usage**
- Description: **Choose how much usage credit to add. Stripe confirms the
  payment before Murph adds it.**
- Three equal choices: **$5**, **$10**, and **$25**
- No default selection and no “popular” badge
- Primary action after selection: **Continue to checkout · $10**
- Pending action: **Opening Stripe…**
- Secondary action: **Cancel**
- An inline accessible error for checkout-creation failure

Offer descriptors come from the server projection. The browser submits only an
opaque offer code and a single-use client request key, never a dollar amount,
grant amount, Stripe Price ID, payer ID, or beneficiary ID.

Home or a private assistant handoff opens the same dialog through a one-shot
Settings URL such as `/settings?addUsage=true#subscription`. Settings removes
the query parameter after initializing the dialog so refresh and Back do not
replay it.

### Checkout Return

The success and cancel URLs return to Settings with the opaque Murph purchase
ID. They do not need to expose a Stripe Session ID. The app session must own the
purchase before any status is returned.

The browser renders only server-read status:

| State | Copy |
| --- | --- |
| Checkout canceled or expired | **Checkout canceled. No usage was added.** |
| Payment processing | **Payment submitted. Stripe is confirming it.** |
| Fulfilled | **Usage added.** |
| Payment failed | **The payment did not complete. No usage was added.** |
| Reconciliation delayed | **Your payment is still being confirmed. You can safely leave this page.** |

A success query parameter is never proof of payment. Settings may poll a
bounded authenticated purchase-status endpoint or request the same idempotent
reconciliation used by the webhook, then refresh its server projection. It
must not say **Usage added** until the grant entry is committed.

Likewise, Stripe's `cancel_url` does not itself cancel an open Session. The
authenticated cancel-return handler re-fetches the bound Session and
idempotently expires it only when it is still open. A concurrent paid or
processing state wins and renders its truthful status; a query parameter alone
never marks the purchase expired.

### Conversation And Notice Copy

The assistant may explain the server-projected state and offer the first-party
Settings handoff. It cannot select an offer, create Checkout, choose a payer or
beneficiary, or claim that a purchase completed.

A reply-anchored personal exhaustion message may say:

> You've used your included usage and any usage credit. You can add more in
> Settings.

Keep the wording factual, conversational, and low-pressure. Use only a full
first-party Settings URL, never a shortened URL. Do not add recurring nudges,
marketing language, urgency, or cold re-engagement.

A fulfilled grant invalidates a queued stale exhaustion notice. If credit is
later exhausted again, at most one new reply-anchored notice is eligible for
the new capacity epoch derived from the newest grant entry. Multiple grants
before exhaustion collapse into one epoch. The delivery claim must re-read
current effective capacity immediately before sending.

## Ownership And Data Flow

```text
Settings -> apps/web purchase service -> Stripe Checkout
                                      -> Stripe payment
Stripe webhook -> HostedStripeEvent -> verified purchase reconciliation
                                      -> immutable credit grant
Usage callback -> canonical HostedAiUsage -> included allowance settlement
                                         -> immutable credit debit
Projection -> Settings / Home / assistant handoff
```

`apps/web` owns every durable record and decision in this flow. Cloudflare and
assistant runtime receive only the bounded projection/action needed for the
current conversation. Stripe metadata is a lookup hint, never authorization.

Personal members and synthetic thread containers already consume usage through
`HostedMember.id`. Use that existing identifier as the beneficiary key. Do not
add a generic `UsageAccount` table unless a later non-member usage subject
proves it necessary.

## Durable Model

The names below are illustrative; the semantics are required.

### `HostedUsageCreditPurchase`

One row represents one intentional attempt to purchase one offer.

| Field | Contract |
| --- | --- |
| `id` | Random opaque Murph purchase ID; safe as the only Stripe metadata lookup key. |
| `payerMemberId` | Authenticated personal member paying. Separate from beneficiary even when equal in v1. |
| `beneficiaryMemberId` | `HostedMember.id` whose usage receives credit. |
| `authorizationContext` | Versioned value such as `personal_self_v1`; future group authorization is explicit. |
| `offerCode` | Immutable internal catalog code. |
| `cashCurrency` / `cashAmountMinor` | Expected Checkout subtotal, initially USD cents. |
| `grantUsdMicros` | Usage capacity promised by the offer. |
| `conversionPolicyVersion` | Freezes cash-to-usage semantics for audit and future pricing changes. |
| `clientRequestKey` | Payer-scoped unique key that makes a lost browser response safely retryable. |
| `requestFingerprint` | Immutable digest of offer and target semantics; reusing a client key with a different request conflicts. |
| `checkoutRequestPolicyVersion` | Version plus explicit frozen Checkout fields used to reconstruct the exact Stripe request after ambiguity. |
| `checkoutCreateState` | `not_started`, `in_flight`, `attached`, `unknown`, or `closed`; fences the Stripe/DB ambiguity window. |
| `status` | `created`, `checkout_open`, `payment_pending`, `fulfilled`, `expired`, or `payment_failed`. Refund/dispute projections are separate. |
| Stripe references | Checkout Session, PaymentIntent, Charge, and Customer lookup/encrypted references using the existing hosted billing-ref pattern. |
| timestamps | Creation, Checkout-create attempt, Checkout expiry, paid, fulfilled, and terminal timestamps. |

Cash amount, grant amount, and conversion version are copied from the
server-owned offer catalog when the purchase is created. They are never
re-derived from the mutable current catalog or from Stripe's final amount.
Before provider I/O, also freeze the exact reusable Price reference, Customer
reference, mode, quantity, tax and payment-method settings, exact success and
cancel URLs, metadata, client reference, and expiration. Retries reconstruct
the same normalized request from those explicit fields; a later catalog,
environment, domain, or payment-policy
change cannot alter it. Store a request digest for verification, not as a
substitute for the reconstructible fields.

Financial records must not blindly cascade with member or group deletion.
Implementation must extend the account export/deletion workflow with the
minimum legally required payment record, identity detachment, and retention
policy before launch.

### `HostedUsageCreditEntry`

The source of truth for usage credit is an append-only set of signed entries.

| Entry kind | Amount | Unique source |
| --- | ---: | --- |
| `purchase_grant` | positive | paid purchase / Checkout Session |
| `usage_debit` | negative | canonical `HostedAiUsage.id` plus the grant entry it consumes |
| `refund_reversal` | negative | Stripe Refund, grant entry, and cumulative refund state |
| `dispute_reversal` | negative | Stripe Dispute funds-withdrawn state plus grant entry |
| `reversal_restoration` | positive | failed refund or reinstated dispute funds plus original reversal |

Each entry contains beneficiary member, signed USD micros, effective time,
source type and opaque source identity, purchase and parent grant when
applicable, a beneficiary-monotonic sequence, and creation time. The sequence
is allocated by incrementing a compact credit-version counter on the existing
beneficiary `HostedMember` while holding the beneficiary lock; it is not a
plain database sequence. Admission reads the same counter under the same lock,
so rollback and transaction commit order cannot make a later grant eligible to
earlier work. The counter owns ordering only and is not a balance source.

One usage event may allocate across multiple grants, so its debit uniqueness
is `(usage event, grant entry)` rather than the usage event alone. A uniqueness
constraint on each semantic source prevents duplicate grants or allocations
even when Stripe creates multiple Event objects or handlers run concurrently.

Never edit or delete an entry to correct history. Append a compensating entry.
An optional balance projection may be added only if measured read/lock cost
requires it; it is rebuildable from the ledger and is never an independent
source of truth.

Available credit is the sum of effective entries and has a nonnegative
invariant. A refund or dispute can revoke only unused credit attributable to
that purchase. Any already-consumed amount whose payment is forcibly reversed
is recorded as a private purchase loss/risk fact, not negative usage credit,
not a deduction from a later purchase, and not a reason to silently suspend an
otherwise valid plan.

## Usage Settlement

Do not increment `HostedAiUsagePeriod.limitUsdMicros` and do not mutate a
thread container's configured monthly limit. Current allowance reconciliation
derives the base limit and repairs a mismatched stored period value, so either
shortcut would be overwritten.

The allowance resolver instead derives two independent quantities:

- base included capacity for the usage event's plan and period; and
- purchased credit still available from positive entries that were eligible
  when the counted platform operation was admitted.

Every purchase grant, usage debit, refund reversal, dispute reversal,
restoration, and effective-capacity recomputation must acquire the same
beneficiary-scoped database lock before any purchase, period, or grant lock.
Period-row locking alone is insufficient because carryover credit can be
consumed concurrently by late prior-period and current-period usage. Use one
fixed lock order across all paths and revalidate rows after acquiring it.
Credit-aware admission briefly acquires that same lock to read and issue its
cutoff.

For each newly canonical usage event, under that beneficiary-wide lock:

1. Preserve the current server-owned pricing, counted/not-counted,
   provider-credential, model-fail-closed, period, and abuse-limit rules.
2. Apply the event to the period's monotonic total spend as today.
3. Compute the portion of this event covered by remaining included capacity.
4. For only the excess portion, consume still-available positive entries at or
   before the event's trusted credit-eligibility sequence, oldest grant first,
   and append one allocation debit per grant used by the canonical usage event.
5. Cap the debit at credit actually available for that event. Any amount by
   which a crossing operation exceeds the capacity visible at admission is
   absorbed by Murph; it is not debt and is never collected from a later
   purchase.
6. Recompute effective exhaustion from base remaining plus available purchased
   credit.

Every counted platform operation receives a web-authoritative
`creditEligibilitySequence` with its local admission decision: the latest
credit-ledger sequence visible before provider work starts, or explicit
absence. The transport carries an opaque web-issued token bound to member,
operation identity, and cutoff rather than exposing the numeric sequence.
Web validates the token and persists the resolved value with the usage record.
Runtime and model cannot select it. Positive grants or restorations created
after the cutoff are never eligible for that operation, while all intervening
debits and reversals still reduce current availability. A missing, legacy, or
invalid cutoff fails closed to no purchased-credit debit; it must never infer
eligibility from callback arrival time.

This makes a provider operation started before checkout unable to consume the
new purchase even if its usage callback arrives afterward. The existing
`occurredAt` is captured after provider result and is insufficient for this
boundary. Base included capacity still settles in beneficiary-serialized
accounting order rather than rewriting immutable events chronologically. If a
late pre-grant event would have changed which earlier event used included
capacity, Murph absorbs the conservative difference instead of retroactively
charging purchased credit. Semantic-source uniqueness makes replay idempotent,
and the beneficiary lock makes the original allocation order singular.

Fulfillment reads the purchase's beneficiary, acquires the beneficiary lock,
then locks and revalidates the purchase, appends the grant, marks the purchase
fulfilled, and, only when a current allowance-period row already exists,
recomputes its exhaustion marker in one transaction. It clears that marker only
when effective capacity is positive. Fulfillment must not create a synthetic
allowance period merely because an eligible member bought credit before their
first counted usage. Notice claim and model-admission readers must derive the
same effective state whether or not a period row exists.

After commit, if the beneficiary still has active entitlement and runnable
usage-blocked work, the existing Stripe-event retry owner sends an idempotent
runtime recheck. That event path is not operationally complete until the grant
is durable and the required recheck handoff is accepted or an existing durable
reconciliation owner proves an equivalent wake. A delayed payment that settles
after cancellation or suspension still grants the purchased credit but does
not require a runtime wake; the entitlement-reactivation owner performs the
later recheck. The browser return is never the wake or fulfillment authority.

## Checkout Creation

Add a dedicated usage-credit service beside, not inside, subscription
onboarding checkout. The current subscription service rejects active members
and creates `mode=subscription` Sessions; top-ups are repeatable one-time
payments.

The authenticated Settings route performs this sequence:

1. Verify same-origin/CSRF protections and the hosted app session.
2. Parse a strict bounded body containing only offer code and client request
   key.
3. Derive payer and personal beneficiary from the app session.
4. Recheck active direct paid Pulse/Edge access and non-suspension.
5. Resolve the offer through a server allowlist.
6. Load the payer's canonical Stripe Customer; missing or ambiguous billing
   state fails closed for repair rather than creating a duplicate Customer.
7. Reconcile or return any existing nonterminal Checkout for the payer; v1
   permits only one open, pending, or unknown purchase at a time.
8. Create or return the durable purchase for the client request key. Reuse with
   a different request fingerprint is a conflict, not a returned old purchase.
9. Freeze the reconstructible Checkout request fields and request digest.
10. Atomically claim its one Checkout-create attempt before provider I/O.
11. Create one Stripe Checkout Session with an idempotency key derived from the
   purchase ID.
12. Persist the returned references and redirect URL before returning it.

The Stripe Session uses:

- `mode=payment`;
- one reusable one-time Price with quantity `1`;
- the existing payer Customer;
- `client_reference_id` equal to the opaque purchase ID;
- Session metadata containing only purchase ID, purpose, and policy version;
- the same opaque purchase ID in `payment_intent_data.metadata` for later
  refund/dispute correlation;
- a fixed short `expires_at`, initially 30 minutes, copied to the purchase;
- no adjustable quantity, promotion codes, or caller-selected Price; and
- server-generated Settings success/cancel URLs.

Use a distinct purchase ID for every intentional purchase. A member can buy
the same pack twice, so member-plus-offer is not an idempotency key.

The create call has an explicit ambiguous-outcome fence. If the process loses
the response after provider I/O begins, mark or retain `checkoutCreateState` as
`unknown`; never send the purchase with a new Stripe idempotency key, never
create a replacement purchase for that payer while the outcome is unknown,
and never tell the browser to retry as a fresh purchase.

Reconciliation reconstructs the frozen request, verifies its digest, and first
retries that identical request with the same key while Stripe retains it. It
also consumes matching webhooks and can boundedly list Sessions for the
expected Customer and creation window to adopt exactly one Session with the
purchase's client reference and metadata. Zero matches remain unknown
until the configured Session-expiry and event-reconciliation window proves no
payable Session remains; multiple matches are an incident and fail closed.
Only then may the attempt close and the payer start another purchase. Stripe's
temporary idempotency window protects the external call; the request key,
request fingerprint, attempt fence, and unique grant sources provide permanent
Murph-side convergence.

## Stripe Catalog And Payment Configuration

Create one Stripe Product named **Murph usage credit** and reusable one-time
Prices for $5, $10, and $25 USD. Keep Price IDs in server configuration and map
them from internal offer codes. Archive rather than mutate an old Price when
cash or grant semantics change, and create a new conversion-policy version.

Reusable Prices are preferable to inline `price_data` for fixed packs because
they remain governed and searchable in Stripe's catalog. Inline prices remain
a possible later implementation for genuinely arbitrary server-calculated
amounts, not this MVP.

Use Dashboard-managed dynamic payment methods unless a reviewed requirement
limits the top-up configuration to immediately confirmed methods. Delayed
methods are safe only because the UI and fulfillment model include
`payment_pending`; Checkout completion alone never grants credit.

Before live launch, finance/counsel must classify the prepaid service credit,
configure the Product tax code and Price tax behavior, and decide where Stripe
Tax is enabled. If tax is charged in addition to the pack subtotal, the member
still receives the catalog's exact usage grant. Never derive credit from
`amount_total`, which can include tax, discounts, or other adjustments.

## Webhook Fulfillment

Reuse the existing signed Stripe webhook receipt and pointer-only
`HostedStripeEvent` reconciliation workflow. Add an explicit usage-purchase
branch before subscription-shaped Checkout handling so a one-time Session can
never bind or mutate subscription entitlement.

Relevant events include:

- `checkout.session.completed`;
- `checkout.session.async_payment_succeeded`;
- `checkout.session.async_payment_failed`;
- `checkout.session.expired`;
- `refund.created`, `refund.updated`, and `refund.failed`; and
- `charge.dispute.created`, `charge.dispute.updated`,
  `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`, and
  `charge.dispute.closed`.

The event is a nudge, not the grant payload. Reconciliation re-fetches live
Stripe state and, before granting, verifies all of these against the immutable
purchase:

- expected Session ID association and live/test mode;
- `mode=payment` and `payment_status=paid`;
- exact Customer when supplied;
- exact reusable Price and quantity `1` from retrieved line items;
- exact subtotal and currency;
- expected purchase metadata and client reference; and
- associated PaymentIntent/Charge identity.

An unpaid `checkout.session.completed` becomes `payment_pending`.
`checkout.session.async_payment_succeeded` can later fulfill it. A failed or
expired Session never grants credit.

The webhook is authoritative. The Settings return endpoint may call the same
reconciler for latency, but concurrent calls must converge on the same purchase
and unique grant entry. A fast `2xx`, signature verification, existing event
dedupe, semantic source uniqueness, bounded retries, and poison-event handling
remain mandatory because Stripe delivery can be duplicated and out of order.

## Refunds And Disputes

V1 has no instant self-service cash-out. A payer may request a support-assisted
refund; another group participant or beneficiary cannot refund someone else's
purchase.

For ordinary refunds, return only the unused attributable portion of a
purchase. A partial successful refund produces a proportional cumulative grant
reversal, with the final reversal receiving any integer-rounding remainder. A
full refund is permitted only while the full grant remains unused, and then
reverses the full grant. Store each Stripe Refund's latest authoritative state
and recompute the desired cumulative reversal rather than assuming event order.

Never delete the original grant or rewrite usage. Apply no reversal for a
failed refund. If Stripe later changes an already-applied refund to a failed
state, append a restoration rather than rewriting history.

Disputes are keyed by Stripe Dispute ID. A created dispute flags the associated
purchase for review. Withdrawn funds revoke the unused remainder attributable
to that purchase; reinstated funds append a restoration of what was actually
revoked. Multiple disputes or refunds for one payment must never reverse more
than its unused grant.

If forcibly reversed cash exceeds unused credit, record the consumed portion
as a private payment loss/risk fact. Do not make a later top-up repay it,
silently disable current entitlement, erase canonical usage, expose debt in a
group chat, or charge another participant.

## Security And Privacy

- The browser cannot select payer or beneficiary identity.
- The model cannot select identity, amount, offer, Price, or Checkout URL.
- Stripe metadata contains only the opaque purchase lookup and non-sensitive
  fixed-purpose/version values; no contact, plan, group, or health data.
- Raw Stripe references follow the existing encrypted-reference plus blind
  lookup-key pattern and never enter logs, assistant state, or user-visible
  URLs.
- Checkout status is visible only to its authenticated payer in v1.
- Webhook signatures and live Stripe re-fetch are both required.
- Logs and metrics use fixed status/reason codes and counts, not member IDs,
  payer identity, metadata payloads, receipts, or raw webhook bodies.
- Checkout creation is bounded per authenticated payer and request key; Stripe
  Radar and a reviewed operational velocity ceiling must be configured before
  production launch.
- Payment records and health-sharing permissions remain separate. Buying usage
  never grants access to another person's data.

## Future Group-Container Funding

The later group feature reuses the same purchase and credit-entry semantics:

- `payerMemberId` is the authenticated person entering Checkout;
- `beneficiaryMemberId` is the group's synthetic thread-container
  `HostedMember.id`; and
- Stripe Customer belongs to the payer, never automatically to the group owner
  or synthetic container.

The first safe meaning of “anyone in the group can fund” is any authenticated,
currently active participant whose relationship to the exact group is proven
by web-owned authority. Anonymous public funding, email-sender identity, and a
stale participant roster are not payment authority.

The group handoff must be a new opaque, short-lived funding intent bound to the
exact originating container and route. It must not reuse a personal Settings
URL, group join code, or vault-sharing capability. Browser authentication and a
fresh relationship check precede purchase creation. After a paid Checkout, the
bound beneficiary remains fixed even if the payer later leaves; if the group
was deleted or made ineligible before fulfillment, reconciliation stops for
support/refund rather than redirecting value elsewhere.

Group chat may show only aggregate included usage and aggregate usage credit.
It must not reveal who paid, contribution history, email, Customer ID, card,
personal plan, refund request, dispute, or private receipt. Receipt and refund
control stay in the payer's private billing surface. Delivery stays on the
exact originating group route with no personal-home fallback.

Future group offers may use reusable $1, $2, $5, $10, and $20 USD Prices. The
$1 amount is above Stripe's general $0.50 USD minimum, but its processing-fee,
tax, fraud, and support economics require explicit launch approval. Offer
denominations remain catalog policy rather than ledger schema.

## Observability And Reconciliation

Track secret-safe counts and latency for:

- purchase created and Checkout creation failed;
- Checkout creation unknown and time spent awaiting adoption;
- Checkout open, payment pending, fulfilled, expired, and failed;
- paid-to-grant reconciliation latency;
- refund/dispute reversal and restoration;
- available-credit exhaustion; and
- status-route polling and terminal reconciliation failures.

Alert on invariant violations:

- verified paid purchase without a grant after the retry window;
- grant without a verified paid purchase;
- more than one grant for one semantic payment source;
- more than one Stripe Session for one purchase or an unknown create past its
  reconciliation window;
- Stripe subtotal/Price/currency/Customer mismatch;
- purchase routed into subscription entitlement handling;
- stale exhaustion notice after positive effective capacity;
- ledger projection drift; and
- a ledger projection below zero or an unreconciled forced-payment loss.

Provide an operator reconciliation command or bounded job that reads purchase
IDs, re-fetches Stripe, and runs the same idempotent state transition. Do not
make a second queue or second fulfillment implementation.

## Rollout And Rollback

1. Finalize tax classification, catalog semantics, and refund policy. Resolve
   the checked-out source discrepancy and prove the single enforced usage gate
   that this primitive will extend.
2. Add the database schema, deletion/export coverage, ledger invariants, and
   read-only projection with the feature disabled.
3. Deploy webhook/event consumers and refund/dispute reconciliation before any
   producer can create a top-up Checkout.
4. Create and verify the Stripe Product, Prices, payment-method configuration,
   tax settings, event subscriptions, Radar rules, and environment mappings in
   test mode, then live mode.
5. Exercise duplicate, concurrent, delayed-payment, refund, dispute, and stale
   notice paths in test mode. Run shadow effective-capacity calculations
   against canonical usage without changing admission.
6. Expand the signed usage contract and storage to accept an optional
   web-issued credit-eligibility cutoff, then deploy every paid-credit-consuming
   producer. Legacy omission means no purchased-credit debit. Do not let
   purchased credit authorize usage until every admitted counted operation
   either carries a valid cutoff or is explicitly excluded.
7. If assistant/runtime receives a new `add_usage` action, deploy the tolerant
   consumer contract before web can emit it. Web-only Settings/Home UI can ship
   independently behind the flag.
8. Activate the purchased-credit extension and paid Checkout together only
   after production smoke proof shows that no-credit exhaustion remains
   blocked and a fulfilled grant wakes pending work and restores service.
9. Observe reconciliation lag and invariant alerts before widening exposure.

Rollback disables new Checkout creation and the Add usage actions first. It
does not delete purchases or grants and must not disable the existing usage
limit. A rollback must keep already-purchased credit effective or preserve a
compatible reader until it is consumed or refunded; it cannot strand paid
capacity behind an older gate.

## Verification

Implementation requires focused tests for:

- offer allowlisting, CSRF/session auth, eligibility, and missing billing refs;
- same-pack intentional repurchase, lost-response retry, and client-key reuse
  with a different offer;
- process loss before/after Checkout creation, same-key adoption, zero/multiple
  Session reconciliation, and no second payable Session after Stripe's
  idempotency window;
- exact Checkout request reconstruction after catalog, domain, tax, or
  payment-policy configuration changes;
- Checkout request shape and one-time/subscription dispatch separation;
- spoofed Price, subtotal, currency, Customer, metadata, environment, and
  beneficiary rejection;
- duplicate and concurrent webhook/success reconciliation;
- completed-but-unpaid, async success, async failure, and expiry;
- cancel-return expiry versus concurrent payment completion;
- atomic grant plus effective-exhaustion recomputation;
- fulfillment before any allowance-period row exists, without creating one;
- delayed-payment fulfillment after cancellation or suspension, without a
  poisoned runtime-recheck retry;
- included-first settlement, crossing-event partial debit, carryover, monthly
  reset, serialized late-callback behavior, and no debit of usage already
  committed before the grant;
- pre-grant in-flight work, post-grant work, later grant/restoration exclusion,
  cutoff replay/binding, and missing/invalid cutoff behavior;
- grant commit versus admission-cutoff ordering, rollback, and concurrent
  counter allocation under the beneficiary lock;
- concurrent prior-period/current-period usage, grant, refund, and dispute
  mutations under the beneficiary-wide lock;
- canceled/suspended/trial/Family access behavior;
- partial/full refunds, failed refunds, multiple disputes, and reinstatement;
- notice invalidation and one notice per capacity epoch;
- purchase export/deletion and financial retention behavior;
- Settings dialog accessibility, selection, redirect, pending, success,
  cancellation, error, and one-shot deep-link cleanup;
- shared Settings/Home/assistant projections and low-pressure copy;
- no-credit exhaustion blocking, crossing-operation behavior, pending-input
  preservation, route-correct notice delivery, grant-triggered runtime recheck,
  re-exhaustion after credit consumption, and deploy-skew behavior; and
- future payer-not-beneficiary and group privacy/route fixtures.

Required implementation verification includes the relevant web tests,
workspace typecheck, schema/migration checks, Stripe webhook test fixtures, and
browser proof for desktop and mobile Settings flows.

## Non-Goals

The individual MVP does not add arbitrary amounts, auto-recharge, saved-card
off-session charges, discounts, gifting, transfers, cash redemption, public or
anonymous funding, Family funding, group funding, Stripe Meter reporting, or a
second usage/accounting service.

## Rejected Alternatives

- **Stripe Billing Credits:** limited to eligible metered subscription items
  reported through Stripe Meters and applied when invoices finalize. It does
  not match Murph's existing immediate cost-weighted allowance.
- **Stripe token billing:** the current official docs label it private preview.
  The primitive must not depend on access Murph does not have.
- **Stripe advanced usage-based billing:** its real-time credit burn and
  automatic top-ups require adopting Stripe's separate Metronome-backed usage,
  pricing, and billing stack. That is a billing-system migration, not the
  smallest extension of Murph's current authoritative meter.
- **Stripe Customer invoice balance:** automatically applies to invoices and
  is not product-usage capacity.
- **Stripe Entitlements:** represents feature access, not a quantified credit
  balance.
- **Payment Links:** cannot safely derive and bind payer, beneficiary, offer,
  purchase idempotency, and group authorization in Murph's control plane.
- **Inline arbitrary Checkout prices:** fixed packs are safer as governed,
  reusable Prices.
- **Mutating the allowance-period limit:** current resolver repair overwrites
  it and carryover would duplicate value across periods.
- **A new generic usage-account service/table:** `HostedMember.id` already
  unifies personal and synthetic-container usage ownership.
- **Granting on the success redirect:** the browser may never return and the
  redirect is not payment authority.

## Official Stripe References

- [Checkout Sessions create API](https://docs.stripe.com/api/checkout/sessions/create)
- [Expire a Checkout Session](https://docs.stripe.com/api/checkout/sessions/expire)
- [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment)
- [Checkout success-page guidance](https://docs.stripe.com/payments/checkout/custom-success-page)
- [Products and Prices](https://docs.stripe.com/products-prices/how-products-and-prices-work)
- [Manage Prices](https://docs.stripe.com/products-prices/manage-prices)
- [Webhooks](https://docs.stripe.com/webhooks)
- [Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [Metadata](https://docs.stripe.com/metadata)
- [Refunds](https://docs.stripe.com/refunds)
- [Disputes](https://docs.stripe.com/disputes/how-disputes-work)
- [Stripe Tax with Checkout](https://docs.stripe.com/payments/checkout/taxes)
- [Dynamic payment methods](https://docs.stripe.com/payments/payment-methods/dynamic-payment-methods)
- [Currency minimums](https://docs.stripe.com/currencies)
- [Customer invoice balance](https://docs.stripe.com/billing/customer/balance)
- [Stripe Entitlements](https://docs.stripe.com/billing/entitlements)
- [Billing Credits](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits)
- [Token billing](https://docs.stripe.com/billing/token-billing)
- [Advanced usage-based billing comparison](https://docs.stripe.com/billing/subscriptions/usage-based/advanced/compare)

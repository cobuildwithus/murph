# Hosted Usage Top-Ups

Status: Implemented personal v1; group funding remains future scope
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

Stripe proves money movement. `apps/web` is authoritative for the payer,
beneficiary, offer, grant, available usage credit, consumption, refund and
dispute adjustments, and any future group authorization.

## Enforced Usage Contract

Hosted included-usage exhaustion blocks subsequent usage-bearing work. Top-ups
extend the capacity evaluated by that one enforced boundary; they do not add a
second admission owner or exhaustion policy.

1. Active subscription or sponsored entitlement remains the prerequisite for
   service. Credit never creates or extends entitlement.
2. Current-period included allowance is used first.
3. Purchased usage credit is used next.
4. When neither is available, the usage-limit block remains in force. The
   restored or extended gate must keep accepted conversation input durable and
   pending rather than silently dropping it or inventing a second terminal
   policy.
5. A request admitted before its usage crosses the boundary may finish. Later
   usage-bearing work observes the settled exhausted state, so the product must
   not promise an exact token-level cutoff.
6. A fulfilled top-up makes effective capacity positive and uses the existing
   retry-owned runtime recheck path to reopen pending accepted work.

No Stripe request belongs on the model-start or reply critical path. The
single gate reads only Murph's local durable effective-capacity
projection: included capacity remaining plus eligible purchased credit
remaining.

### Implemented Boundary

`apps/web` owns one composed access-and-usage decision. It blocks provider work
when included allowance and purchased credit are both exhausted, preserves
accepted input for retry, and keeps route-specific notice behavior in the
existing allowance owner. Cloudflare, Temporal, and the assistant runtime own
no Stripe, purchase, ledger, or credit-balance state.

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

A success query parameter is never proof of payment. Settings polls a bounded
authenticated purchase-status endpoint and refreshes its server projection. It
does not invoke payment reconciliation and must not say **Usage added** until
the webhook-owned grant entry is committed.

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

The crossing send and a later mutating gate denial reuse one capacity-epoch
delivery identity. Epoch zero preserves the pre-credit member-and-period key,
so deploy-skew retries cannot duplicate a legacy notice. A failed or in-flight
Linq or Telegram claim returns its durable retry time to runtime
reconciliation; Temporal owns that recheck while the accepted input remains
pending. Read-only status reconciliation never invokes a notice provider.

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
| `remainingCreditUsdMicros` | Rebuildable per-purchase unused-credit projection for settlement and financial reversals. |
| `conversionPolicyVersion` | Freezes cash-to-usage semantics for audit and future pricing changes. |
| `clientRequestKey` | Payer-scoped unique key that makes a lost browser response safely retryable. |
| `requestFingerprint` | Immutable digest of offer and target semantics; reusing a client key with a different request conflicts. |
| `checkoutRequestPolicyVersion` | Version of the fixed Checkout builder used with the stored request fields and digest. |
| `checkoutCreateState` | `not_started`, `claimed`, `attached`, or `closed`; `claimed` is the durable ambiguity fence from before provider I/O until one Session is attached or absence is proven. |
| `status` | `created`, `checkout_open`, `payment_pending`, `fulfilled`, `expired`, or `payment_failed`. Refund/dispute adjustments remain ledger entries. |
| Stripe references | Checkout Session, PaymentIntent, Charge, and Customer lookup/encrypted references using the existing hosted billing-ref pattern. |
| timestamps | Creation, Checkout-create retry cutoff, Checkout expiry, paid, fulfilled, and terminal timestamps. |

Cash amount, grant amount, and conversion version are copied from the
server-owned offer catalog when the purchase is created. They are never
re-derived from the mutable current catalog or from Stripe's final amount.
Before provider I/O, also freeze the exact reusable Price and Customer
references, success and cancel URLs, metadata, client reference, expiration,
policy version, and normalized request digest. V1 mode, quantity, and
PaymentIntent metadata are fixed by that policy's code. Retries reconstruct the
request from the stored fields and reject a digest mismatch. Catalog, domain,
and environment changes do not alter stored values; a behavior-changing
Checkout builder must retain the old policy reader or drain claimed purchases.

The initial authenticated transaction authorizes and freezes one purchase
attempt. Replaying an identical `claimed` attempt is not a new purchase
authorization: it reconciles that already-authorized provider write from the
frozen request with the same purchase-derived Stripe idempotency key. The replay
must not reinterpret the attempt as a fresh checkout against mutable catalog or
eligibility state, mint a replacement attempt, or require a second browser
authorization. A lifecycle change such as account deletion instead suspends new
checkout creation and explicitly resolves or expires the outstanding claimed
attempt before deleting its local owner state.

Financial records do not cascade blindly through the Prisma relations. The
account deletion owner removes local ledger entries before purchases and the
member, while Stripe retains payment records under its required retention.
Browser-vault export omits payment identifiers, Checkout URLs, semantic source
keys, usage references, and allocation history.

### `HostedUsageCreditEntry`

The source of truth for usage credit is an append-only set of signed entries.

| Entry kind | Amount | Unique source |
| --- | ---: | --- |
| `purchase_grant` | positive | paid purchase / Checkout Session |
| `usage_debit` | negative | canonical `HostedAiUsage.id` plus the grant entry it consumes |
| `refund_reversal` | negative | Stripe Refund, grant entry, and cumulative refund state |
| `dispute_reversal` | negative | Stripe Dispute funds-withdrawn state plus grant entry |
| `reversal_restoration` | positive | reinstated dispute funds plus original reversal |

Each entry contains beneficiary member, signed USD micros, effective time,
source type and opaque source identity, purchase and parent grant when
applicable, a beneficiary-monotonic sequence, and creation time. The beneficiary
`HostedMember` holds a compact, rebuildable available-credit projection and
credit-version counter, while each purchase holds its own rebuildable
unused-credit projection. While holding the beneficiary row lock, every entry
append increments the version and updates the affected projections in the same
transaction. Admission and settlement read bounded fields instead of
aggregating an indefinitely growing ledger. The ledger remains canonical; a
bounded repair can rebuild the projections from its entries.

One usage event may allocate across multiple grants, so its debit uniqueness
is `(usage event, grant entry)` rather than the usage event alone. A uniqueness
constraint on each semantic source prevents duplicate grants or allocations
even when Stripe creates multiple Event objects or handlers run concurrently.

Never edit or delete an entry to correct history. Append a compensating entry.
The compact balance/version fields are a read projection, not an independent
source of truth, and every mutation verifies that their result remains
nonnegative before commit.

Available credit is the sum of effective entries and has a nonnegative
invariant. A refund or dispute can revoke only unused credit attributable to
that purchase. Already-consumed value is not turned into negative usage credit,
deducted from a later purchase, or used to suspend an otherwise valid plan.

## Usage Settlement

Do not increment `HostedAiUsagePeriod.limitUsdMicros` and do not mutate a
thread container's configured monthly limit. Current allowance reconciliation
derives the base limit and repairs a mismatched stored period value, so either
shortcut would be overwritten.

The allowance resolver derives two independent quantities:

- base included capacity for the usage event's plan and period; and
- purchased credit still available when the canonical usage event settles.

Every purchase grant, usage debit, refund reversal, dispute reversal,
restoration, and effective-capacity recomputation must acquire the same
beneficiary-scoped database lock before any purchase, period, or grant lock.
Period-row locking alone is insufficient because carryover credit can be
consumed concurrently by late prior-period and current-period usage. Use one
fixed lock order across all paths and revalidate rows after acquiring it.
Credit-aware admission reads the compact balance/version projection from the
same durable owner.

For each newly canonical usage event, under that beneficiary-wide lock:

1. Preserve the current server-owned pricing, counted/not-counted,
   provider-credential, model-fail-closed, period, and abuse-limit rules.
2. Apply the event to the period's monotonic total spend as today.
3. Compute the portion of this event covered by remaining included capacity.
4. For only the excess portion, consume still-available positive entries at or
   before the ledger version re-read under the beneficiary lock, oldest grant
   first, and append one allocation debit per grant used by the canonical usage
   event.
5. Cap the debit at credit actually available in that serialized settlement.
   Any excess from the crossing operation is absorbed by Murph; it is not debt
   and is never collected from a later purchase.
6. Recompute effective exhaustion from base remaining plus available purchased
   credit.

The current runtime does not transport an admission-bound credit cutoff. V1
re-reads the beneficiary ledger version while holding the settlement lock and
uses that version as the eligibility boundary. This gives concurrent grants,
debits, reversals, and usage callbacks one deterministic order, but it does not
distinguish an operation that started before a grant and settled afterward.
Adding an admission-bound token would be a separate hardening change, not a
claim of the current implementation. Semantic-source uniqueness keeps replay
idempotent, and the beneficiary lock makes the allocation order singular.

Fulfillment reads the purchase's beneficiary, acquires the beneficiary lock,
then locks and revalidates the purchase, appends the grant, marks the purchase
fulfilled, and, only when a current allowance-period row already exists,
recomputes its exhaustion marker in one transaction. It clears that marker only
when effective capacity is positive. Fulfillment must not create a synthetic
allowance period merely because an eligible member bought credit before their
first counted usage. Notice claim and model-admission readers must derive the
same effective state whether or not a period row exists.

After commit, the existing Stripe-event retry owner sends an idempotent runtime
recheck for an active beneficiary. A signal failure keeps the Stripe event
retryable; no second wake queue exists. A delayed payment that settles after
cancellation or suspension still grants the purchased credit, but an inactive
beneficiary does not require a runtime wake. Entitlement reactivation performs
the later recheck. The browser return is never the wake or fulfillment
authority.

## Checkout Creation

The dedicated usage-credit service sits beside, not inside, subscription
onboarding checkout. Subscription onboarding creates `mode=subscription`
Sessions; top-ups are repeatable one-time payments.

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
   permits only one claimed, open, or payment-pending purchase at a time.
8. Create or return the durable purchase for the client request key. Reuse with
   a different request fingerprint is a conflict, not a returned old purchase.
9. Freeze the reconstructible Checkout request fields and request digest.
10. Atomically move its one Checkout-create attempt from `not_started` to
    `claimed` before provider I/O.
11. Recheck that the frozen create-retry cutoff has not passed, retrieve the
    configured Stripe Price, and verify its live/test mode, active state,
    one-time per-unit shape, currency, exact amount, and absence of custom,
    transformed, or multi-currency amount semantics.
12. Create one Stripe Checkout Session with an idempotency key derived from the
    purchase ID. After the cutoff, return the durable reconciling state without
    Stripe I/O.
13. Persist the returned references and redirect URL before returning it.

The Stripe Session uses:

- `mode=payment`;
- one reusable one-time Price with quantity `1`;
- the existing payer Customer;
- `client_reference_id` equal to the opaque purchase ID;
- Session metadata containing only purchase ID, purpose, and policy version;
- the same opaque purchase ID in `payment_intent_data.metadata` for later
  refund/dispute correlation;
- a frozen `expires_at` 90 minutes after purchase creation plus a frozen
  Checkout-create retry cutoff 30 minutes after purchase creation;
- Adaptive Pricing explicitly disabled so Dashboard defaults cannot change the
  frozen USD catalog contract;
- no adjustable quantity, promotion codes, or caller-selected Price; and
- server-generated Settings success/cancel URLs.

Use a distinct purchase ID for every intentional purchase. A member can buy
the same pack twice, so member-plus-offer is not an idempotency key.

The create call has one explicit ambiguous-outcome fence. `claimed` means the
process may have crashed before the request, during it, or after Stripe accepted
it; no stale-owner timeout reopens creation. Never send the purchase with a new
Stripe idempotency key, create a replacement purchase for that payer while it
is claimed, or tell the browser to retry as a fresh purchase.

The service reconstructs the frozen request and verifies its digest for every
create retry. It may call Stripe with the same key only before the frozen
30-minute retry cutoff. The frozen 90-minute `expires_at` therefore remains at
least 60 minutes after any permitted create call and never needs mutation.
After the retry cutoff, the service does not list or search for Sessions; it
returns `reconciling` without provider I/O and keeps the payer fenced until the
frozen expiry. If no webhook attached or fulfilled the purchase by then, the
next locked read closes the unattached attempt and permits a new purchase. A
matching verified webhook may still reconcile the original purchase. Stripe's
idempotency window protects the external call; the request key, fingerprint,
attempt fence, and unique grant sources provide Murph-side convergence.

## Stripe Catalog And Payment Configuration

Create one Stripe Product named **Murph usage credit** and reusable one-time
Prices for $5, $10, and $25 USD. Keep Price IDs in server configuration and map
them from internal offer codes. Archive rather than mutate an old Price when
cash or grant semantics change, and create a new conversion-policy version.

Reusable Prices are preferable to inline `price_data` for fixed packs because
they remain governed and searchable in Stripe's catalog. Inline prices remain
a possible later implementation for genuinely arbitrary server-calculated
amounts, not this MVP.

Checkout creation re-fetches the configured Price and fails closed unless it
is the exact active one-time, per-unit, single-currency amount frozen on the
purchase. Do not use custom unit amounts, transformed quantity, or extra
currency options for v1.

Use Dashboard-managed dynamic payment methods unless a reviewed requirement
limits the top-up configuration to immediately confirmed methods. Delayed
methods are safe only because the UI and fulfillment model include
`payment_pending`; Checkout completion alone never grants credit.

Before live launch, finance/counsel must classify the prepaid service credit
and confirm the Product tax code and Price tax behavior. V1 does not enable
Stripe Tax or support tax added above the catalog amount: reconciliation
requires both the live Checkout subtotal and total to equal the purchase's
fixed cash amount. Supporting tax-inclusive or tax-added Checkout later needs
an explicit request and reconciliation policy change; the usage grant must
still come from the frozen catalog conversion, not a client-supplied amount.

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
- `charge.refunded`;
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

The webhook is authoritative. Settings return handlers read durable status
only; the cancel-return path may re-fetch and idempotently expire an open bound
Session, while a paid or processing state wins. A fast `2xx`, signature
verification, existing event dedupe, semantic source uniqueness, bounded
retries, and poison-event handling remain mandatory because Stripe delivery
can be duplicated and out of order.

## Refunds And Disputes

V1 has no instant self-service cash-out. A payer may request a support-assisted
refund; another group participant or beneficiary cannot refund someone else's
purchase.

For ordinary refunds, return only the unused attributable portion of a
purchase. Reconciliation re-fetches the relevant Refund when available, its
Charge and PaymentIntent, and the Charge's bounded canonical Refund list.
`pending`, `requires_action`, and `succeeded` Refund amounts are active cash
exposure, so they reserve the proportional unused credit immediately rather
than waiting for settlement. The live Charge's cumulative refunded amount may
lag a pending refund: it must be at least the sum of succeeded Refunds and no
greater than the active Refund total. A failed or canceled Refund removes that
exposure and appends a restoration for credit that was actually reversed. A
full active refund can revoke the full grant only while it remains unused. The
original grant and canonical usage are never edited.

Disputes are keyed by Stripe Dispute ID. Created or updated disputes establish
correlation but do not revoke credit until funds are withdrawn or the dispute
is lost. Withdrawn funds revoke the unused remainder attributable to that
purchase; reinstated funds append a restoration of what was actually revoked.
Multiple disputes or refunds for one payment must never reverse more than its
unused grant.

If forcibly reversed cash exceeds unused credit, the ledger revokes only the
unused remainder and never creates a negative balance. It does not make a later
top-up repay the rest, disable current entitlement, erase canonical usage,
expose debt in a group chat, or charge another participant.

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
bound beneficiary remains fixed even if the payer later leaves. The later group
implementation must define its beneficiary-deletion and idempotent-refund state
machine together; value must never be redirected when the bound group no longer
exists or is no longer eligible.

Group chat may show only aggregate included usage and aggregate usage credit.
It must not reveal who paid, contribution history, email, Customer ID, card,
personal plan, refund request, dispute, or private receipt. Receipt and refund
control stay in the payer's private billing surface. Delivery stays on the
exact originating group route with no personal-home fallback.

Payer and beneficiary deletion semantics must be separated before enabling
group funding. Deleting a payer removes or detaches that payer's private
billing references, receipt/status access, and refund-control data according to
the payment-retention policy, but it must not erase the beneficiary's purchase
provenance, ledger entries, or balance projection. Deleting the beneficiary or
group owns the distinct credit-revocation and purchase-resolution path. A
`payerMemberId OR beneficiaryMemberId` bulk delete is therefore valid only for
personal v1, where those identities are required to be equal, and is not a
group-compatible deletion design.

Future group offers may use reusable $1, $2, $5, $10, and $20 USD Prices. The
$1 amount is above Stripe's general $0.50 USD minimum, but its processing-fee,
tax, fraud, and support economics require explicit launch approval. Offer
denominations remain catalog policy rather than ledger schema.

## Operations And Reconciliation

The existing `HostedStripeEvent` receipt is the retry owner and records attempt
state, next-attempt time, and a bounded error code. Purchases record their
Checkout state, payment state, and last reconciliation time. Identity,
catalog, payment, duplicate-grant, negative-balance, and projection invariants
fail closed and leave the Stripe event retryable.

V1 does not add a second queue or a separate operator reconciliation service.
Operational checks should watch for paid purchases without grants, claimed
Checkout creation past its reconciliation window, Stripe identity/catalog
mismatches, subscription dispatch of a one-time purchase, projection drift,
and negative-balance attempts. Any future operator command must re-fetch Stripe
and call the same idempotent reconciler by purchase ID.

## Rollout And Rollback

1. Configure and verify the one-time Product and three Prices, keep Stripe Tax
   disabled for this flow, confirm equal subtotal/total behavior, and verify
   payment settings, webhook event subscriptions, Radar rules, and environment
   mappings in Stripe test mode, then live mode.
2. Apply the database migration before deploying the web release.
3. Deploy the Cloudflare/runner bundle that accepts the new `add_usage`
   plan-usage action, then wait for the tolerant consumer to be current. It owns
   no billing, Stripe, purchase, or credit state and remains compatible with the
   old web response.
4. Deploy the web release containing the enforced gate, ledger, webhook branch,
   refund/dispute reconciliation, Settings routes, and `add_usage` projection
   together.
5. Before widening exposure, smoke a blocked no-credit member, a paid webhook
   grant, runtime recheck, subsequent usage debit, refund reversal, and dispute
   restoration in Stripe test mode.

Rollback disables new Checkout creation and the Add usage actions first. It
does not delete purchases or grants and must not disable the existing usage
limit. A rollback must keep already-purchased credit effective or preserve a
compatible reader until it is consumed or refunded; it cannot strand paid
capacity behind an older gate.

The first durable purchase row establishes a rollback floor for every Web,
runtime, and account-deletion path that reads, enforces, settles, or removes
usage state. After that point, do not deploy an older path that ignores purchase
rows or cannot preserve their invariants. Disable the producer and Price offers
while compatible consumers remain deployed before any rollback, then stay at
that floor or forward-fix. Rolling a consumer below the floor requires an
explicit migration or proof that no purchase state remains; merely hiding the
Settings action is insufficient.

## Verification

Current focused unit and component coverage exercises:

- the exact fixed offers, request parsing, direct-paid eligibility, durable
  create claim, stable idempotency key, retry cutoff, and active-purchase fence;
- payer-bound status and cancel-expiry routes, CSRF rejection, and paid-state
  precedence over cancellation;
- grant/debit replay, included-first FIFO settlement, crossing overrun, capped
  refund/dispute reversals, and dispute restoration through fake Prisma
  transaction clients;
- real PostgreSQL grant replay, beneficiary-before-purchase lock ordering,
  grant/debit serialization, and deletion-first cleanup against a guarded
  isolated database;
- live-state Stripe reconciliation through mocks, including paid, delayed,
  failed, expired, spoofed-Price, `charge.refunded` provenance, and
  one-time-versus-subscription dispatch cases;
- composed usage blocking, carryover credit, trial and group behavior, and
  current-period block clearing; and
- the Settings dialog's no-default selection, exact offer post, stable-key
  retry, redirect, read-only return polling, cancel expiry, and delayed state.

These suites do not prove a real Stripe test-mode webhook or deployed browser
behavior. Release verification therefore still needs the scoped web tests and
typecheck, desktop/mobile browser proof, and a Stripe test-mode paid Checkout
plus webhook smoke.

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
- [Billing credits](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits)
- [Billing for LLM tokens](https://docs.stripe.com/billing/token-billing)
- [Advanced usage-based billing](https://docs.stripe.com/billing/subscriptions/usage-based/advanced/compare)
- [Adaptive Pricing per Checkout Session](https://docs.stripe.com/changelog/acacia/2024-11-20/adaptive-pricing-param)
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

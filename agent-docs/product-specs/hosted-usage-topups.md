# Hosted Usage Top-Ups

Status: Implemented personal, Family-member, and hosted-group funding
Last verified: 2026-08-10

## Decision

Use a one-time Stripe payment and a Murph-owned, append-only usage-credit ledger
to decide who receives the usage and how it is consumed. Current-policy
personal and Family funding reuses the exact Murph billing Subscription's
attached default card, or the attached Customer default that Subscription
inherits. The billing Subscription must match the frozen purchase Customer;
missing, stale, terminal, customer-mismatched, unattached, or legacy Source-only
state falls back to Checkout, and unrelated Subscriptions never participate.
Hosted-group funding does not require a Murph billing Subscription and may use
the attached Customer default or sole attached card only when no legacy
Customer default Source exists. Stripe's `allow_redisplay` setting
controls whether Checkout may show a stored method again; it does not gate the
payer's explicit use of the existing subscription card for a top-up.

The personal and Family offer catalog is:

| Offer code | Checkout subtotal | Usage credit granted |
| --- | ---: | ---: |
| `usage_5_usd` | $5 USD | $5 of Murph usage credit |
| `usage_10_usd` | $10 USD | $10 of Murph usage credit |
| `usage_25_usd` | $25 USD | $25 of Murph usage credit |

The one-time group contribution catalog is:

| Offer code | Checkout subtotal | Usage credit granted |
| --- | ---: | ---: |
| `usage_5_usd` | $5 USD | $5 of Murph usage credit |
| `usage_10_usd` | $10 USD | $10 of Murph usage credit |
| `usage_20_usd` | $20 USD | $20 of Murph usage credit |

Group funding presents capped monthly sponsorship as the primary choice and a
one-time contribution as the secondary choice. A monthly sponsor selects a
$5, $10, or $20 maximum; the activation and automatic refills are ordinary
exact $5 purchases. No public surface converts dollars or usage credit
into an estimated message count. `usage_25_usd` remains parseable for historical
purchases and available only to current personal and Family surfaces.

The cash subtotal and granted usage value are separate immutable purchase
facts even when the initial offer is one-for-one. One dollar of v1 usage credit
is one dollar of capacity under Murph's existing AI usage meter.
It is not a token count, bank balance, Stripe customer balance, subscription
invoice credit, transferable asset, or promise of cash redemption.

Stripe proves money movement. `apps/web` is authoritative for the payer,
beneficiary, offer, grant, available usage credit, consumption, and refund and
dispute adjustments. An authenticated member may also fund an active hosted
group by presenting that group's existing opaque join code; the group's
synthetic thread-container member is the beneficiary.

An active Family owner may fund one exact active member through Family
Settings. The owner is the payer, the selected member is the beneficiary, and
Checkout uses the existing Family-group Stripe Customer.

## Enforced Usage Contract

Hosted included-usage exhaustion blocks subsequent usage-bearing work. Top-ups
extend the capacity evaluated by that one enforced boundary; they do not add a
second admission owner or exhaustion policy.

1. Active subscription or sponsored entitlement remains the prerequisite for
   service. Credit never creates or extends entitlement.
2. Current-period included allowance is used first.
3. Generic usage credit, including purchase and earned-referral grants, is used
   next.
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
projection: included capacity remaining plus eligible usage credit
remaining.

### Implemented Boundary

`apps/web` owns one composed access-and-usage decision. It blocks provider work
when included allowance and usage credit are both exhausted, preserves
accepted input for retry, and keeps route-specific notice behavior in the
existing allowance owner. Cloudflare, Temporal, and the assistant runtime own
no Stripe, purchase, ledger, or credit-balance state.

## Product Outcome

An eligible paid Pulse or Edge member can:

1. See one overall percentage for all currently available usage.
2. Open a small **Add usage** dialog over Settings.
3. Choose $5, $10, or $25 without a preselected or promoted option.
4. Explicitly authorize the selected amount. Murph charges one canonical saved
   card when available; otherwise Stripe Checkout collects card details or
   verification.
5. Return to Settings while bounded browser reconciliation observes webhook
   fulfillment; the browser never treats the success URL as payment proof.
6. For personal and owner-seat Family credit, see fulfilled credit move the
   authenticated beneficiary's existing usage bar without a success dialog or
   exact balance when that bar is present. If personal usage status is
   unavailable, or for another active or former Family member, see one concise
   close-owned result because no beneficiary meter is present.
7. If usage was blocked, have pending accepted work become runnable after the
   verified grant restores capacity.
8. Continue using that credit after an included-usage reset until the credit is
   consumed.

An authenticated member can open `/groups/fund/[joinCode]` at any capacity.
The route does not publish the group's usage state. It immediately opens the
applicable existing control: capped monthly sponsorship for an unsponsored
group, one-time contribution for a participant who is not the current
automatic sponsor, pending-purchase recovery for the exact payer, or private
sponsorship management for the exact active payer. Closing an immediate
dialog or drawer leaves only the composable alternative action and the return
link. This does not require the payer to have an individual paid plan. The
browser submits only the server-owned fixed $5 activation offer, selected
monthly maximum, request key, and bounded optional sponsorship draft for
monthly creation. A one-time contribution submits the selected fixed offer
without a monthly maximum. A recovery attempt adds only the literal
recovery-only capability. Web resolves payer, beneficiary, amount, grant, and
sponsorship policy.
If a payment is recovered, Web restores the authenticated payer's exact
encrypted sponsor draft, shows that it is still attached, and resubmits it
unchanged. Every active-purchase recovery compares the normalized draft,
including omission, with the frozen digest before another Stripe operation.
The digest describes only the content that passed customization authorization
and can therefore be restored or published. A failed encrypted-draft read does
not enable payment retry, while an intentionally empty draft is shown
explicitly. Canceling the active payment is the only way to replace that draft.
Once the purchase is terminal, an exact request-key recovery with a remounted
or changed draft returns the frozen purchase as a nonpayable sponsorship
selection conflict and acknowledges the durable key match. The new draft is
not applied. A `created` purchase past its checkout deadline is first closed by
the existing expiry owner, so a lost response cannot pin the browser in a
request-key conflict loop.
If the payer has one canonical attached card, Murph confirms that payment
without a Checkout redirect. Otherwise Stripe Checkout collects or verifies
the card.

An active Family owner can use the same dialog from an exact active member row
in Settings. The fixed pack is credited only to that selected member. A
sponsored member cannot buy a personal pack, and Family credit is neither
shared nor transferable. The same conservative saved-card selection and
Checkout fallback apply. A sessionless saved-card fulfillment initiated inside
Manage keeps its verified result visible in that dialog until the payer closes
it; the page meter does not replace feedback while the broader Manage dialog is
still active.

## Capped Monthly Group Sponsorship

The monthly authorization is a payer-approved maximum, not a Stripe
Subscription, prepaid bundle, balance, or promise to charge the maximum. One
live authorization per beneficiary records the payer, status, selected cap,
activation-anchored period, and optional cap decrease for the next period. It
does not store charged spend or capacity.

Current-period committed spend is derived from the authorization's `created`,
`checkout_open`, `payment_pending`, and `fulfilled` purchases. Payer-visible
charged spend is derived only from fulfilled purchases, with pending commitment
shown separately. A new refill is admitted only when the existing group
capacity owner reports low or exhausted capacity and at least $5 remains under
the cap. The beneficiary lock serializes this check and deterministic
authorization-period-ordinal purchase creation.

The existing post-settlement usage path may create that local purchase. It
never calls Stripe or waits for payment. The bounded Web billing sweep performs
saved-card work after commit. Stripe event reconciliation is the only authority
that grants the $5 through the existing append-only credit ledger and reopens
pending group work. Failed or authentication-required payment moves the
authorization to private recovery and blocks later automatic charges. A
same-period recovery may reset that exact failed purchase only while its $5
charge still fits under the current cap. If the payer has since reduced the cap
to fulfilled spend, recovery leaves the failed purchase as immutable history
and returns the authorization to active-at-cap without starting Stripe.

Periods roll forward lazily from the successful activation anchor with
calendar-month and end-of-month semantics. The cap resets, but unused credit
remains available in the existing ledger. An increase requires explicit payer
confirmation and may apply immediately. A decrease below current committed
spend is staged for the next period. The sponsor may pause, resume, cancel, or
recover privately; payer deletion and financial reversals fail closed without
rewriting purchase history.

Ordinary participants see only whether the chat is sponsored. They do not see
the payer, maximum, amount charged or pending, credit, percentage, message
count, or automatic refill events. The exact payer privately sees the current
period's fulfilled and pending amounts, maximum, period end, status, and
management controls. A near-cap notice is private and revalidated against the
current authorization. The room is notified only when the existing usage gate
actually pauses work. Every exhausted room receives the ordinary pause copy and
the current first-party funding link. The message does not branch on or expose
the current funding setup; the funding page separately preserves any active
automatic sponsor and the single-sponsor billing invariant.

## Group Sponsorship Moment

Every explicit one-time group contribution and monthly activation purchase has
one purchase-linked sponsorship-moment row. Automatic $5 refills do not create
another moment, creative response, group notice, or running bit. The moment is
not a financial status or balance. It freezes an HMAC-bound request
configuration and, only for a current owner or active participant, may encrypt
an optional public alias, optional creative request, and temporary running-bit
request using the hosted member secure-box owner. A new public alias is stored
in the existing bounded encrypted plain-text shape so preceding Web can still
recover and materialize the purchase. One separate nullable metadata field
records the exact funding-page recognition consent; legacy rows carry no such
consent.

A creative request is absent by default, so funding alone is quiet in the room.
The bounded formats are `message`, `poem`, and `song`. Every request may include
an optional premise; a song may additionally include one genre or style
reference. Named songs, shows, soundtracks, artists, and genres are interpreted
only as broad traits such as mood, tempo, instrumentation, and structure. They
never authorize copied melody, lyrics, catchphrases, vocal identity, or a
signature arrangement. The encrypted creative envelope is versioned and exists
only for an explicit request. A null creative-request column means quiet for
both current and pre-feature rows. A pre-feature encrypted generic note is
normalized only into a plain-message request; it can never be reinterpreted as
song consent. Pre-feature rows without that note never produce a creative
response.

A valid funding locator remains sufficient to contribute anonymously. It is
not sufficient to publish content into the room. Web checks current
participant authority when the purchase is created and again after verified
payment. Losing that authority suppresses the new authored creative request
without changing the grant and leaves the funding-page publication marker null.
The alias field itself is optional recognition consent: the collection copy
names signed-in group members as the audience and bounds visibility to an active
monthly sponsorship or the 20 most recent contributions; blank means
`Anonymous`. The server retains an alias-only draft only with that exact
consent marker. Legacy aliases can still support their originally disclosed
creative or running-bit use but never gain funding-page consent. No expired
private copy is read or exposed.

For a signed-in active group participant, the funding page may recognize the
current live monthly sponsorship activation and at most the 20 most recent
fulfilled one-time contribution moments. It displays only `Monthly sponsor` or
`One-time contribution` with the moment's consented public alias only when the
first verified-settlement transaction also marked it publishable after its
creator-authority recheck, falling back to `Anonymous`; a later settlement
replay cannot acquire publication authority. The alias is a
presentation label, not authenticated payer identity. Pre-feature aliases,
pending or incompletely materialized moments, and moments settled after the
creator lost authority remain Anonymous. The projection never exposes payer records, contribution amounts,
monthly maximums, charge timing, balances, automatic refills, or payment
status. Signed-out visitors and non-participants receive no supporter
projection. Alias decryption is best effort and degrades to `Anonymous` without
blocking funding. The complete funding, management, cancellation, and recovery
controls stream first; supporter recognition renders in a separate Suspense
boundary with a null fallback. Its two-second abort signal is checked between
the initial database stages and is forwarded to the secure-box batch; Prisma
does not cancel an in-flight query, and a secure-box metadata lookup immediately
after an overlapping moment read may begin before external crypto observes the
abort. This is not a wall-clock database deadline. The primary funding and
recovery controls never await this optional boundary.

The funding-page read reuses the page's participant-authority result, then adds
at most four set-based database calls: sponsorship authorization and 20-row
one-time history in parallel, an optional activation purchase, and one moment
batch for at most 21 purchase IDs. Peak added database concurrency is two. The
secure-box owner opens alias ciphertexts in one batch and performs at most 21
root unwraps with its existing concurrency cap of four; there are no per-row
database reads, provider calls, or transactions. The optional read is outside
the page's blocking data fanout. The shared signal bounds external secure-box
work, but an already-started Prisma query and the immediate secure-box metadata
lookup described above may still finish in the background without delaying the
primary controls.

Verified Stripe reconciliation remains the only activation authority. After a
fulfilled group purchase, Web idempotently:

1. activates a requested bit for 24 hours on a `$10` one-time contribution or
   72 hours on a `$20` one-time contribution;
2. stops without creating a public notification when no creative response was
   explicitly requested;
3. otherwise resolves the exact current non-direct group destination, with no
   personal fallback; and
4. appends one purchase-deduplicated creative notification to the existing
   mailbox.

Permanent schema validation failure in a decrypted optional creative envelope
projects as no creative request at this notification boundary. Activation,
including an otherwise valid running bit, commits and Stripe receipt completion
continues through the independent near-cap owner. Creator recovery stays strict,
and secure-box, decryption, database, and other operational failures continue to
propagate for ordinary retry rather than being mislabeled as quiet content.

A monthly activation is the actual `$5` purchase eligible for the optional
social response. Its private monthly maximum never changes the public
acknowledgment or creates a running bit.

The creative turn is isolated and runs as a fresh ephemeral thread on the
resident App Server. Message and poem formats use an output-only turn profile,
so they have no tools rather than relying on prompt compliance alone. Song
format projects only `generate_song`, which is used exactly once. A song is
exactly 15 seconds with at most four short lyric lines. The requested format
cannot be changed by participant-authored prompt text. The response transforms
one vivid, recent, non-sensitive detail, exchange, or room dynamic from the
current group conversation into a room-specific hook when one is available.
The optional premise is the preferred creative seed when it blends naturally
with the room.
When neither source offers a safe, usable premise, the response becomes a
gentle group celebration in the requested format without inventing personal
facts or referring to sensitive history.

Serious, urgent, medical, sensitive, or conflict-heavy recent context makes the
response gentle and non-comedic. A creative provider failure terminally settles
this optional notification instead of asking the model to try another song. A
selected song without exactly one generated voice-memo attachment fails before
receipt, transcript persistence, or delivery and is never replaced by a
text-only response. Once a delivery intent commits, the ordinary outbox retains
its retry and deduplication behavior. There is no reservation, attempt counter,
post-hoc media-attempt accounting, or media-specific retry state. The reconciler
wakes newly paid usage work before attempting this optional social effect, and
notification failure never rolls back an already committed credit grant.

The running bit remains a Web-owned expiring product fact, not durable group
memory. Mailbox fetch projects only the newest active bit to fresh,
route-authorized, non-direct Linq or Telegram conversation input. The running-bit
reader decrypts only the alias and bit, so an unavailable or malformed creative
envelope cannot suppress an otherwise valid active bit. The runtime rechecks
expiry before prompt construction and quotes the alias and requested bit as
untrusted participant-authored data. It is optional social color only:
facts, health and safety guidance, privacy, permissions, routing, tools,
challenge scoring, access, and response quality are unchanged. Failure to read
the optional bit projects no bit and never blocks ordinary mailbox work.

Private Murph may list a server-built sponsorship URL for each current group
membership. The model cannot choose a monthly maximum, attach sponsor copy,
change an authorization, or charge a card. Multiple simultaneous automatic
sponsors, public spend rankings, exact-message accounting, and provider-level
delivery deadlines remain out of scope.

## Individual MVP

### Eligibility

The first release permits purchases only when all of these are true:

- the browser has a current authenticated hosted app session;
- the beneficiary is that same direct personal member;
- hosted access is active and not suspended;
- the member has a paid Pulse or paid Edge subscription;
- the member has canonical existing Stripe Customer and Subscription bindings;
- the member is not a synthetic thread container;
- the member neither owns nor belongs to an active, unsuspended Family account
  group; and
- the selected offer is active in the server-owned catalog.

Starter keeps **Start a paid plan** rather than selling top-ups. Sponsored Family
owners and members are excluded because their payer/beneficiary policy belongs
with the separate Family funding rules below. An inactive, unpaid, or suspended
group relationship does not exclude an otherwise eligible direct paid member.
Cancellation, past-due, suspension, and malformed billing state fail closed.

One read-only server projection owns these rules and returns only currently
authorized offer codes. Settings presentation, plan-usage `add_usage`
projection, and new-purchase authorization all consume it. It checks Stripe
binding lookup-key presence without decrypting billing identifiers. Recovery of
an already-frozen purchase occurs before this mutable eligibility/config read.

Purchased credit does not expire in v1. It survives monthly allowance resets
and a subscription cancellation, but it is usable only after an eligible plan
is active again. It cannot be transferred between members or applied to a
subscription invoice.

### Presentation

Settings renders one bounded percentage from counted usage in the current
display window and all remaining effective capacity. The window starts at the
allowance-period boundary or, when later, the latest fulfilled purchase grant
in that period. Buying credit therefore starts a fresh 0%-used display, and
only later counted usage advances it. The presentation does not expose the
internal dollar value of the plan allowance or the usage-credit balance.

Settings may separately show a bounded history of immutable purchase grants
with the original added amount, source, and date. That history does not read or
display aggregate or per-grant remaining capacity; the combined AI usage bar
remains the only current-capacity view. Present that history as compact flat
rows after mission activity, with one short clarification that the amounts are
added credit rather than the current balance.

Purchased capacity must not be called cash, wallet funds, an account balance,
or refundable dollars. Accounting stays in integer USD micros behind the
web-owned projection.

Settings may show a quiet **Add usage** action at any utilization for an
eligible paid member. Home and assistant surfaces should surface the action
only when the current forecast predicts exhaustion, at least 80% of available
usage is used, or included allowance and usage credit are exhausted. Pulse's
Edge upgrade remains available through the plan card instead of creating a
multi-action usage contract.

### Settings Dialog

`PlanUsageBand` remains the surface owner. Add one client leaf using the
existing `Dialog`, `RadioGroup`, `ChoiceCard`, and `Button` primitives;
do not add a generic payment-modal framework.

The target composition is:

- Title: **Add usage**
- Three equal choices: **$5**, **$10**, and **$25**
- No default selection and no “popular” badge
- No visible explanatory paragraph; the dollar choices and action label carry
  the flow. Keep a concise screen-reader description for the amount selector.
- The group funding route immediately opens its applicable existing group
  control. **Sponsor this chat** is the primary capped-monthly action when no
  automatic sponsor exists; **Make a one-time contribution** is the fallback
  for another payer; and the exact active payer sees private management on the
  same URL. Do not repeat saved-card or verification mechanics there.
- Primary action after selection: **Add usage · $10**
- Pending action: **Adding usage…**
- Secondary action: **Cancel**
- An inline accessible error for checkout-creation failure

Offer descriptors come from the server projection. A normal authorization
submits only an opaque offer code and a single-use client request key. An
ambiguous-response check adds the literal recovery-only capability, never a
dollar amount, grant amount, Stripe Price ID, payer ID, or beneficiary ID.
Before request entry, the browser stores that key in session storage scoped by
the authenticated server-rendered payer identity and server-owned checkout
target. Another account using the same target in that tab receives an
independent slot and cannot consume or clear the first payer's unresolved key.
The stored identity is an idempotency hint, not payer, target, offer, or payment
authority.

Home or a private assistant handoff opens the same dialog through a one-shot
Settings URL such as `/settings?addUsage=true#subscription`. An explicit
request for that page may receive the link after a current paid-access read
even below the threshold for a proactive recommendation. Settings removes the
query parameter after initializing the dialog so refresh and Back do not replay
it. If current authority returns no offers, that deep link still opens an
honest **Usage credit unavailable** state with no purchase control.

### Checkout Return

The success and cancel URLs return to Settings with the opaque Murph purchase
ID. They do not need to expose a Stripe Session ID. The app session must own the
purchase before any status is returned.

The persisted return URL is also the frozen target locator. A personal purchase
and an owner-seat Family purchase return to `#subscription`; another member's
Family purchase returns to `#family`. The target reader accepts legacy
owner-seat Family URLs at `#family`, but a current billing-mode change never
reinterprets a frozen personal purchase as Family recovery.

When an exact return purchase ID is present, that purchase is the dialog's sole
source of status, conflict, capabilities, copy, and completion. A payer-wide
latest-active projection cannot contribute fields to that returned-purchase
state, even when it is newer. A simultaneous active purchase remains visible
only on its own frozen-target surface; the two purchase records are never
composed into one dialog state.

The browser renders only server-read status:

| State | Copy |
| --- | --- |
| Checkout canceled or expired | **Checkout canceled. No usage was added.** |
| Payment processing | **Payment submitted. We’re confirming it.** |
| Fulfilled | **Usage added.** |
| Payment failed | **The payment did not complete. No usage was added.** |
| Reconciliation delayed | **Your payment is still being confirmed. You can safely leave this page.** |

Personal and owner-seat Family success returns keep the dialog visually quiet
while the authenticated beneficiary's existing usage meter refreshes. Their
fulfilled transition updates one visually hidden polite status region that was
already mounted before reconciliation, but shows no visible success modal or
post-purchase messaging handoff. Failed or exhausted reconciliation opens the
compact recovery dialog. If personal usage status is unavailable, the existing
off-meter host instead keeps a compact result visible until Close and confirms
only that durable credit reached the account. Another active Family member and
former-member recovery use the same close-owned pattern because Settings does
not render that beneficiary's usage meter. The Family roster mounts the exact
active member's returned-purchase owner independently of its Manage dialog;
the result's Close action owns terminal refresh so the confirmation cannot
disappear before the payer dismisses it. Group funding retains its separately
owned receipt and Messages handoff.

A success query parameter is never proof of payment. Settings polls a bounded
authenticated purchase-status endpoint and refreshes its server projection. It
does not invoke payment reconciliation and must not say **Usage added** until
the webhook-owned grant entry is committed.

When a fresh request recovers an already-open Checkout for the same exact
server-approved target, the dialog names that state and offers explicit
**Resume checkout** and **Cancel checkout** actions.
Current plan eligibility or offer configuration cannot strand that frozen
purchase; cancellation still uses the authenticated mutation and live Stripe
state described below. Suspension withholds the stored Checkout URL and Resume
action, while the payer-owned purchase remains visible and cancelable.

Settings projects the payer's active frozen purchase server-side and releases
payment capability only when its frozen target exactly matches a current
server-approved target. The dialog performs no purchase-status or provider I/O
until the member opens it.
For a still-unattached `created` purchase, the server derives a **Retry
checkout** capability only while the payer is unsuspended and the exact
30-minute create-retry window remains. The capability is not durable state.
At the cutoff, or while suspended, Settings keeps the honest reconciling state
but withholds Retry; it never substitutes a new purchase or idempotency key.
At the exact 90-minute frozen expiry, Settings stops projecting an unattached
`created` row so the current amount picker is available again. The next Add
usage request closes that old row under the beneficiary-first admission lock
order before creating a fresh purchase; the read projection itself performs no
mutation or provider I/O.
Only that public reconciling state carries the derived `restartAt` capability.
An already-open dialog uses it to clear stale local recovery state and refresh
Settings at the exact boundary; no other general purchase timestamp is exposed.

Likewise, Stripe's `cancel_url` does not itself cancel an open Session. The
authenticated cancel-return handler re-fetches the bound Session and
idempotently expires it only when it is still open. A concurrent paid or
processing state wins and renders its truthful status; a query parameter alone
never marks the purchase expired.

### Conversation And Notice Copy

The assistant may explain the server-projected state and offer the first-party
Settings handoff. For Family management, it must first read current Family
status and require the explicit active owner, active billing, and exact active
member. The owner's own active seat receives the stable
`/settings?addUsage=family#family` handoff; Settings resolves it against the
authenticated owner's current Family rather than accepting identifiers from
the model. Another active member receives `/settings#family` so the owner
selects the member inside Settings. The assistant cannot select an offer,
create Checkout, choose a payer or beneficiary, or claim that a purchase
completed.

A stored reply-anchored personal exhaustion message is neutral, for example:

> You've used your included usage and any usage credit. Murph is paused for this
> usage period.

Keep the wording factual, conversational, and low-pressure. Use only a full
first-party Settings URL, never a shortened URL. Do not add recurring nudges,
marketing language, urgency, or cold re-engagement.

Low capacity is conversational rather than a notice. An allowed ordinary 1:1
or group mailbox fetch carries a coarse trusted `low` bit into that accepted
turn. Murph completes the request first, then may add one casual sentence that
the conversation may pause soon unless more usage is added. The prompt forbids
token counts, prices, internal accounting, contributor identity, pressure, and
repetition when the recent conversation already contains the warning. The bit
does not schedule or send a separate outbound message.

For a hosted group, `fundingNeeded` controls only that assistant-initiated
depletion thread. A valid `fundingUrl` remains available independently. When a
person explicitly asks to fund the room or add usage, Murph may share the
current returned URL at any capacity; the first unsolicited heads-up remains
link-free. A direct request to fund, sponsor, contribute, add group usage, or
get the funding link reads group usage only and does not detour into earned
missions. A broad request for every option or a way to earn usage reads both
current funding and referral state. If the room already has an automatic
sponsor, the page preserves that single-sponsor invariant and offers the
additional payer only a one-time contribution. Murph does not imply the room
needs funding when `fundingNeeded` is false or disclose private sponsor facts.
For low capacity, Web sets that boolean only when no automatic refill is
available or pending. An unresolved current-period refill payment remains
pending recovery even if its authorization has since paused, entered recovery,
or been canceled; terminal purchases do not suppress the warning. The
assistant receives no sponsorship-status field, does not infer why a false
signal was returned, and uses the same warning and follow-up contract for every
room. Referral eligibility uses the ordinary runtime access gate and does not
invoke this funding projection.

For a group exhaustion notice, the existing claim rechecks current group usage
and delivery always sends a first-party signed funding-only link with one
deterministic neutral pause message. The message identifies private options and
waiting for reset without pressuring a payer or promising instant recovery.
The mandatory URL is derived only from the runtime member and server
configuration; funding-page sponsor state, group display data, and join-code
preference are not delivery dependencies. Missing or invalid mandatory action
data fails before claim/provider work and never becomes terminal linkless copy.
The production predeploy guard constructs and parses this exact signed URL from
the configured HTTPS hosted origin and signing authority before serving
traffic, and runtime validates against the same origin. A completed crossing
has no separate replay owner, so the pre-serve invariant—not the denied-gate
path—prevents configuration from stranding the one-shot notice. This is one
branchless message contract; it exposes no payment setup, payer, cap, amount,
balance, purchase, or refill facts.

Immediately before a personal exhaustion crossing send and a later personal
denied-gate retry, delivery re-reads the current personal usage-status
projection. It appends the canonical first-party **Add usage** action only when
the recommended action is currently `add_usage`; a failed projection or any
ineligible state sends the neutral copy unchanged.

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
Allowed mailbox fetch -> coarse low-capacity bit -> accepted turn context
Projection -> Settings / Home / assistant handoff
```

`apps/web` owns every durable record and decision in this flow. Cloudflare and
assistant runtime receive only the bounded projection/action needed for the
current conversation. Stripe metadata is a lookup hint, never authorization.

Personal members and synthetic thread containers already consume usage through
`HostedMember.id`. Use that existing identifier as the beneficiary key. Do not
add a generic `UsageAccount` table unless a later non-member usage subject
proves it necessary.

### Minimum V1 Ownership

The minimum durable v1 has three authoritative concepts:

- one purchase row containing payer, beneficiary, frozen offer facts, one
  purchase-status lifecycle, and encrypted or keyed Stripe references;
- one append-only credit ledger containing grants, debits, and signed financial
  adjustments; and
- live Stripe payment state, read only through the existing verified webhook
  receipt owner, as authority for money movement.

The member balance/version and per-purchase remaining-credit fields are bounded,
rebuildable projections of the ledger. Settings status, polling state, usage
notices, allowance exhaustion, and the runtime recheck are derived consumers,
not new lifecycle owners. The beneficiary row lock is the sole serialization
point for usage-credit grants, purchase reservations, debits, projection
adjustments, and every checkout/refill admission that can occupy capacity. A
capacity-admission path that also locks a distinct payer always locks the
beneficiary first.

Group and Family funding compose these same owners without adding a group or
Family wallet, usage account, funding-code lifecycle, scheduler, or queue. The
existing opaque
`HostedGroup.joinCode` locates an active group funding target, and the group's
synthetic thread-container `HostedMember` remains the beneficiary. The
authenticated contributor is the payer. Checkout, accounting, allowance,
refund, dispute, runtime-recheck, and delivery idempotency remain owned by the
same personal top-up services.

For Family funding, the current group owner is the payer, one selected active
membership identifies the beneficiary, and the active group's billing
reference supplies the Stripe Customer. No Family identity or authorization is
copied into the ledger.

### Grant-Slot Capacity

A beneficiary may occupy at most 32 grant slots. An occupied slot is either a
positive active grant projection or an unfulfilled purchase whose
provider-final `grantSlotReleasedAt` marker is null. Every capacity inspection
used for admission reads at most 33 combined occupied rows. Finding a 33rd row
is an invariant violation and fails closed; there is no second capacity owner.
The grant projection stores immutable beneficiary and FIFO sequence copies and
uses a partial positive-balance index, while reservations use a partial
unfulfilled-purchase index. Historical zero-balance grants and released or
fulfilled purchases therefore cannot turn a bounded return into an unbounded
historical scan.

New personal, Family, and group Checkout purchases, automatic group-sponsorship
refills, explicit recovery reacquisition, and unreserved referral grants all
use this shared contract while holding the beneficiary lock. Any distinct payer
lock follows the beneficiary lock. Exact purchase replay observes the existing
reservation and does not reserve again. At capacity, ordinary automatic refill
admission returns no refill, while overflow is an invariant failure.

A genuinely new personal, Family, or group checkout that sees exactly 32
occupied slots returns `HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT` with HTTP 409.
True eligibility errors keep `HOSTED_USAGE_CREDIT_NOT_ELIGIBLE` and HTTP 403,
and exact request-key or matching active-purchase replay resolves before this
admission. The shared top-up dialog maps only the capacity code to a temporary
block explaining that existing credit must be used or a pending payment must
resolve; it does not suggest another amount.

A new purchase reserves its future grant slot before provider work by persisting
an unfulfilled row with a null release marker. Local expiry and ambiguous
failure do not release it. Only provider-correlated final no-payment evidence
records `grantSlotReleasedAt`: exact expired-and-unpaid Checkout evidence from
webhook, retrieve/expire, binding, or account-deletion finalization, or an exact
canceled saved-card PaymentIntent from its explicit terminal owner. Saved-card
release fallback, local expiry, and ambiguous or recoverable provider state stay
reserved. Existing unfulfilled rows whose marker is null remain conservatively
reserved. Explicit recovery may clear a prior release
only after reacquiring capacity. At exactly 32 occupied slots, fulfillment is
allowed only when the exact purchase reservation is replaced by its positive
active grant; an unreserved grant is rejected at that boundary.

## Durable Model

The names below are illustrative; the semantics are required.

### `HostedUsageCreditPurchase`

One row represents one intentional attempt to purchase one offer.

| Field | Contract |
| --- | --- |
| `id` | Random opaque Murph purchase ID; safe as the only Stripe metadata lookup key. |
| `payerMemberId` | Authenticated member paying. Separate from the beneficiary and nullable only after the payer is deleted from a terminal cross-owner purchase. |
| `beneficiaryMemberId` | `HostedMember.id` whose usage receives credit. |
| `offerCode` | Immutable internal catalog code. |
| `cashCurrency` / `cashAmountMinor` | Expected Checkout subtotal, initially USD cents. |
| `grantUsdMicros` | Usage capacity promised by the offer. |
| `remainingCreditUsdMicros` | Rebuildable per-purchase unused-credit projection for settlement and financial adjustments. |
| `clientRequestKey` | Payer-scoped unique key that makes a lost browser response safely recoverable without granting a later create-capable retry. |
| `checkoutRequestPolicyVersion` | Version of the fixed Checkout builder used to reconstruct provider parameters. |
| `status` | `created`, `checkout_open`, `payment_pending`, `fulfilled`, `expired`, or `payment_failed`. Refund/dispute adjustments remain ledger entries. |
| `grantSlotReleasedAt` | Null while an unfulfilled purchase conservatively reserves its future grant slot; set only from provider-correlated final no-payment evidence. |
| Stripe references | Checkout Session, PaymentIntent, Charge, and Customer lookup/encrypted references using the existing hosted billing-ref pattern. |
| Checkout fields and timestamps | Frozen Price and Customer references, success/cancel URLs, 90-minute expiry, and creation, paid, terminal, and last-reconciled times. |

Cash amount and grant amount are copied from the server-owned offer catalog
when the purchase is created. They are never re-derived from the mutable
current catalog or from Stripe's final amount. Before provider I/O, the row also
freezes the exact reusable Price and Customer references, success and cancel
URLs, expiration, and Checkout request policy version. The fixed policy derives
mode, quantity, client reference, and Session and PaymentIntent metadata from
the purchase ID; those derived values are not snapshotted as a second source of
truth. A behavior-changing Checkout builder must retain the old policy reader
or drain `created` purchases that use it.

The initial authenticated transaction authorizes and persists one purchase
before Stripe I/O. That `created` row is the durable ambiguity fence. Replaying
the same payer/request key and funding target continues the same purchase with
the same purchase-derived Stripe idempotency key. Reusing that key for another
target conflicts; reusing it for another offer returns the winning purchase's
status/cancel-only projection. Replay must not reinterpret the purchase against
the mutable catalog, mint a replacement attempt, or require a second browser
authorization. While a purchase is nonterminal, a fresh request
key for that same target may recover it only when the submitted offer still
matches the frozen offer. A different amount returns the earlier purchase's
status/cancel-only projection instead of continuing it under new button copy;
the rejected fresh key has no create authority. If that response is lost,
times out, or is dismissed, **Check payment** resends the key only in
recovery-only mode. Under the beneficiary-first admission lock order,
recovery-only may continue an exact persisted request or return the current
nonterminal purchase. When neither
exists, it returns a typed miss before offer authorization, Customer creation,
purchase insertion, or Stripe I/O. The dialog returns to an unselected picker
but retains that unresolved key in payer-and-target-scoped browser session
storage across dismissal, reload, remount, tab restoration, and same-tab
account switches. The authenticated server-rendered payer identity selects the
slot, so another payer using the same target receives an independent key and
cannot clear the first payer's unresolved identity. A remounted picker hydrates
the key before enabling selection. The next explicit Add action reuses the key
in normal create-capable mode, so the admission locks and request-key uniqueness
serialize it with any delayed original request. Only a durable purchase
response with server-owned proof that the submitted selection key matched for
that payer clears the stored key. Mounted active-purchase and return
projections, projected-purchase retries, and different-key active-purchase
recovery cannot release it. Unavailable or unverifiable storage fails closed
before request entry. If the newly selected offer differs from the winner, only
the winner's nonpayable status/cancel projection is returned. Account deletion
suspends new payment creation. A direct intent that already won the payer-lock binding
boundary remains `payment_pending` until the existing Stripe-event owner
settles it; deletion does not race it with a second cancellation decision. The
payer-owned cancel endpoint can retrieve and cancel that exact sessionless
intent from Settings or any target-conflict surface without beneficiary or
locator authority. A safely canceled intent terminalizes the purchase and
releases the payer-wide fence.

Financial records do not cascade blindly through the Prisma relations. When a
beneficiary is deleted, its ledger entries and purchases are removed before the
member. When only the payer is deleted, terminal credit owned by a surviving
beneficiary remains: the purchase detaches the payer, advances the existing
reconciliation-version fence so payer-era preparation must retry, and clears
encrypted provider references while retaining non-secret lookup keys needed for
later refund or dispute reconciliation. Stripe retains payment records under
its required retention.

A fulfilled direct purchase is valid terminal proof without a Checkout
Session. Payer deletion clears its encrypted PaymentIntent, Charge, Customer,
and Price references, retains the non-secret Customer, PaymentIntent, and
Charge lookup evidence, and leaves both Session references null. Later refund
and dispute events re-fetch the saved-card PaymentIntent and reconcile through
that retained payerless proof.

Browser-vault export omits payment identifiers, Checkout URLs, semantic source
keys, usage references, and allocation history.

### `HostedUsageCreditEntry`

The source of truth for usage credit is an append-only set of signed entries.

| Entry kind | Amount | Unique source |
| --- | ---: | --- |
| `purchase_grant` | positive | paid purchase / Checkout Session |
| `usage_debit` | negative | canonical `HostedAiUsage.id` plus the grant entry it consumes |
| `refund_adjustment` | signed | Stripe Refund, grant entry, and cumulative live refund state |
| `dispute_adjustment` | signed | Stripe Dispute, grant entry, and cumulative live funds state |

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

Never edit or delete an entry to correct history. Append a compensating entry
of the same adjustment kind.

The compact balance/version fields are a read projection, not an independent
source of truth, and every mutation verifies that their result remains
nonnegative before commit.

Available credit is the sum of effective entries and has a nonnegative
invariant. A refund or dispute can revoke only unused credit attributable to
that purchase. Already-consumed value is not turned into negative usage credit,
deducted from a later purchase, or used to suspend an otherwise valid plan.
After both signed-adjustment convergence passes, one final shared capacity read
must still observe at most 32 positive grant projections. Overflow rolls back
the entire transition before receipt binding so the existing Stripe retry owner
can replay it.

## Usage Settlement

Do not increment `HostedAiUsagePeriod.limitUsdMicros` and do not mutate a
thread container's configured monthly limit. Current allowance reconciliation
derives the base limit and repairs a mismatched stored period value, so either
shortcut would be overwritten.

The allowance resolver derives two independent quantities:

- base included capacity for the usage event's plan and period; and
- generic usage credit still available when the canonical usage event settles.

Every purchase or referral grant, usage debit, refund adjustment, dispute
adjustment, and effective-capacity recomputation must acquire the same
beneficiary-scoped database lock before any purchase, period, or grant lock.
Period-row locking alone is insufficient because carryover credit can be
consumed concurrently by late prior-period and current-period usage. Use one
fixed lock order across all paths and revalidate rows after acquiring it.
Credit-aware admission reads the compact balance/version projection from the
same durable owner.

Purchase fulfillment and conversational referral rewards share the same
immutable credit-entry ledger and entry-keyed remaining-capacity projection.
Stripe refunds and disputes remain purchase-only; referral grants are final and
have no financial reversal path. The referral product and qualification
contract lives in
`agent-docs/product-specs/hosted-usage-referrals.md`.

For each newly canonical usage event, under that beneficiary-wide lock:

1. Preserve the current server-owned pricing, counted/not-counted,
   provider-credential, model-fail-closed, period, and abuse-limit rules.
2. Apply the event to the period's monotonic total spend as today.
3. Compute the portion of this event covered by remaining included capacity.
4. For only the excess portion, consume the currently available grants under
   the beneficiary lock, oldest grant first, and append one allocation debit
   per grant used by the canonical usage event.
5. Cap the debit at credit actually available in that serialized settlement.
   Any excess from the crossing operation is absorbed by Murph; it is not debt
   and is never collected from a later purchase.
6. Recompute effective exhaustion from base remaining plus available usage
   credit.

Settlement preserves the reviewed 32-slot maximum. After the bounded replay
check, one data-modifying SQL statement locks and inspects at most 33 positive
grant projections in beneficiary sequence, rejects more than 32 before any
coupled mutation, and computes FIFO allocations with window sums. The statement
updates affected grant and purchase projections set-wise, updates the
beneficiary balance/version projection once, and inserts every debit entry. A
corrupt 33-grant state therefore rolls back completely. Replay reads at most 33
debit rows and rejects more than 32 before entering its bounded validation loop.

The current runtime does not transport an admission-bound credit cutoff. V1
settles against the balance available when the canonical usage callback holds
the beneficiary lock, so a grant committed before settlement may fund that
event even when the operation started earlier. Adding an admission-bound token
would be a separate hardening change, not a claim of the current
implementation. Semantic-source uniqueness keeps replay idempotent, and the
beneficiary lock makes the allocation order singular.

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

The authenticated personal Settings route, Family member route, and group
funding route share this sequence:

1. Verify same-origin/CSRF protections and the hosted app session.
2. Parse a strict bounded body containing offer code and client request key,
   plus only the literal `recoveryOnly: true` capability when recovering an
   unparsed response.
3. Derive the payer from the app session and resolve the beneficiary server
   side: the payer for personal funding, the exact active member selected from
   the payer's active Family roster, or the active group's synthetic member for
   `/groups/fund/[joinCode]`.
4. Continue an exact existing request-key purchase. Reuse for another target is
   a conflict; reuse for another offer returns the winning purchase's
   status/cancel-only projection.
5. With the beneficiary lock held and any distinct payer locked second, expire
   an unattached purchase whose frozen window ended, then recover a nonterminal
   purchase only when its payer and beneficiary match the requested target. A
   purchase for another target
   conflicts. Only one created, open, or payment-pending purchase may exist for
   one payer at a time. If recovery-only finds neither an exact-key purchase nor
   a current nonterminal payer purchase, return a typed miss without resolving
   a Customer, inserting a purchase, or entering Stripe. The browser retains
   that key in payer-and-target-scoped session storage for the next explicit
   normal authorization, including after remount or a same-tab account switch,
   which serializes with any delayed original request under the same lock order.
   The authenticated server-rendered member ID scopes the browser slot; another
   payer using the same target in that tab receives an independent key and
   cannot clear the first payer's unresolved identity. Only a durable response
   carrying server-owned proof that the submitted selection key matched for
   that payer clears it; mounted active or return projections,
   projected-purchase retries, and different-key recovery do not.
6. For a genuinely new purchase, require a current server-owned offer. Personal
   funding also requires the direct-paid eligibility projection. Family
   funding requires the current active owner, active group and billing, and an
   exact active, nonsuspended, personal member. Active group funding does not
   require the payer to hold an individual paid plan.
7. Resolve the canonical Stripe Customer only after authorization. Personal
   funding uses the payer's existing billing customer. Family funding uses the
   existing Family-group customer and never creates a replacement member
   customer. Group funding first runs exact replay and the serialized capacity
   inspection without a Customer; only an admitted new request prepares the
   payer's Customer through the existing owner.
8. Under the beneficiary lock, apply or reapply the shared bounded capacity
   inspection, then create the durable purchase for the client request key with
   a null `grantSlotReleasedAt` marker. Group funding revalidates here after
   Customer preparation because capacity may have changed while no beneficiary
   lock was held. This reserves its future grant slot before later provider
   work; exact replay continues the existing reservation.
9. Freeze the offer, Price, Customer, return URLs, 90-minute expiry, and request
   policy in the `created` purchase before provider I/O.
10. Recheck that the purchase has not expired, retrieve the
    configured Stripe Price, and verify its live/test mode, active state,
    one-time per-unit shape, currency, exact amount, and absence of custom,
    transformed, or multi-currency amount semantics.
11. For current-policy personal and Family purchases, resolve the exact Murph
    billing Subscription already owned by the target and require its Customer
    to match the frozen purchase. Use that Subscription's attached explicit
    default, or its inherited attached Customer default. Missing, stale,
    terminal, customer-mismatched, unattached, or legacy Source-only
    exact-subscription state skips this path, and unrelated Subscriptions never
    participate. Group funding has no required billing Subscription and may
    use the attached Customer default or require exactly one attached card only
    when no legacy Customer default Source exists. Do not treat
    `allow_redisplay` as a chargeability signal.
12. When a canonical card exists, create one unconfirmed PaymentIntent with a
    purchase-derived idempotency key. Under the payer-row lock, re-read the
    payer and purchase. Personal and Family attempts also re-read the current
    persisted billing Customer, Subscription, billing status, suspension state,
    and last accepted Stripe-event time under that lock. Bind only an active
    payer's still-`created` purchase whose complete selected billing authority
    still matches to that exact intent, and only then confirm it off session. If
    a billing change, suspension, deletion, or another terminal transition wins
    that lock, cancel the unbound intent and never confirm it. A retry retrieves
    and continues only an exact already-bound intent without retargeting after a
    later billing change. A definitive authentication or card failure
    must reach verified `canceled` state before its binding is cleared and
    Checkout may begin. An ambiguous outcome remains `payment_pending` and
    cannot start a second payment. The client keeps the original amount and
    request key locked for recovery and does not offer amount changes until the
    purchase becomes terminal.
13. Otherwise create one Stripe Checkout Session with an idempotency key
    derived from the purchase ID. A retry during the derived 30-minute creation
    window repeats the identical request with that same key, leaving at least
    60 minutes on the frozen Session expiry.
14. Persist the returned references and redirect URL before returning it.

The Stripe Session uses:

- `mode=payment`;
- one reusable one-time Price with quantity `1`;
- the existing payer Customer;
- `client_reference_id` equal to the opaque purchase ID;
- Session metadata containing only purchase ID, purpose, and policy version;
- the same opaque purchase ID in `payment_intent_data.metadata` for later
  refund/dispute correlation;
- `setup_future_usage=off_session` for current-policy personal, Family, and
  group Checkout, so the collected card can be reused for a later explicit
  top-up;
- `saved_payment_method_options.payment_method_save=enabled` for current-policy
  Checkout, so the payer can let Stripe present the method again in later
  Checkout flows;
- `saved_payment_method_options.allow_redisplay_filters=["always"]`, so
  historical subscription-limited methods are not silently exposed in a
  separate top-up context;
- a frozen `expires_at` 90 minutes after purchase creation;
- Adaptive Pricing explicitly disabled so Dashboard defaults cannot change the
  frozen USD catalog contract;
- no adjustable quantity, promotion codes, or caller-selected Price; and
- server-generated personal Settings, exact Family-target Settings, or
  group-funding success/cancel URLs.

Use a distinct purchase ID for every intentional purchase. A member can buy
the same pack twice, so member-plus-offer is not an idempotency key.

The persisted `created` purchase is the ambiguous-outcome fence: the process
may have crashed before the request, during it, or after Stripe accepted it.
Never send it with a new Stripe idempotency key, create a replacement purchase
for that payer while it remains nonterminal, or tell the browser to retry as a
fresh purchase.

The service reconstructs the request from the frozen row and fixed request
policy for every create retry. It may call Stripe with the same key only during
the first 30 minutes derived from the purchase creation time. After that
window, it returns the durable reconciling state without provider I/O and keeps
the payer fenced. At or after the frozen 90-minute expiry, the next locked read
closes an unattached `created` purchase and permits a new purchase. A
matching verified webhook may still reconcile the original purchase. Stripe's
idempotency window plus the durable request key, single purchase lifecycle, and
unique ledger sources provide convergence.

Request policy `hosted-usage-credit-checkout-v1` remains reconstructible
without card saving so an in-flight idempotent Checkout request never changes
shape. Version two remains reconstructible with future-use saving and direct
saved-card payment for group purchases only. New purchases freeze
version three with both behaviors for personal, Family, and group targets.
New purchases freeze `hosted-usage-credit-checkout-v4`, which retains those
targets, adds Stripe's explicit payment-method save choice to Checkout, and
binds personal and Family card selection to the target's exact Murph billing
Subscription. It uses that Subscription's explicit default or inherited
Customer default regardless of whether Stripe may redisplay the card in
Checkout. Group funding remains Customer-scoped because it has no required
Murph billing Subscription. Legacy default Sources are unsupported for direct
v4 reuse and stay in Checkout.
Versions one through three retain their original request and selection shapes.
Every retry and Stripe proof check uses the purchase's frozen policy version
rather than the latest global version.

After production persists its first v4 purchase, a v4-capable Web bundle is the
minimum compatible consumer for status, cancellation, Stripe reconciliation,
and account deletion involving retained v4 financial state. A safe rollback
first disables new Add usage and group-funding intake, keeps v4-compatible
consumers running, and forward-fixes. Rolling Web below that floor requires
proof that no v4 purchase or retained v4 financial state exists.

## Stripe Catalog And Payment Configuration

Create one Stripe Product named **Murph usage credit** and reusable one-time
Prices for $5, $10, $20, and $25 USD. Keep Price IDs in server configuration
and map them from internal offer codes. Archive rather than mutate an old Price
when cash or grant semantics change, and create a new offer code and fixed
Price.

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
- `payment_intent.succeeded`;
- `payment_intent.processing`;
- `payment_intent.payment_failed`;
- `payment_intent.canceled`;
- `charge.refunded`;
- `refund.created`, `refund.updated`, and `refund.failed`; and
- `charge.dispute.created`, `charge.dispute.updated`,
  `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`, and
  `charge.dispute.closed`.

The event is a nudge, not the grant payload. Checkout reconciliation re-fetches
live Stripe state and, before granting, verifies all of these against the
immutable purchase:

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

Direct group-payment reconciliation requires the purchase's exact bound
PaymentIntent, re-fetches it, and verifies its amount, received amount,
currency, Customer, environment, metadata purpose/version, and latest Charge.
Only `succeeded` can grant. `processing` remains pending. A canceled or
payment-method-required event cannot terminalize the shared purchase while the
producer is proving safe fallback to Checkout.

The webhook is authoritative. Settings return handlers read durable status
only; the cancel-return path may re-fetch and idempotently expire an open bound
Session, while a paid or processing state wins. A fast `2xx`, signature
verification, existing event dedupe, semantic source uniqueness, bounded
retries, and poison-event handling remain mandatory because Stripe delivery
can be duplicated and out of order.

## Refunds And Disputes

There is no instant self-service cash-out. A payer may request a
support-assisted refund; another group participant or beneficiary cannot refund
someone else's purchase. If the payer account is later deleted, terminal
refund and dispute events remain reconcilable from retained blind lookup keys
and live Stripe state without restoring payer identity.

For ordinary refunds, return only the unused attributable portion of a
purchase. Reconciliation re-fetches the relevant Refund when available, its
Charge and PaymentIntent, and the Charge's bounded canonical Refund list.
`pending`, `requires_action`, and `succeeded` Refund amounts are active cash
exposure, so they reserve the proportional unused credit immediately rather
than waiting for settlement. The live Charge's cumulative refunded amount may
lag a pending refund: it must be at least the sum of succeeded Refunds and no
greater than the active Refund total. A failed or canceled Refund removes that
exposure by appending a positive `refund_adjustment` for credit actually
revoked. A full active refund can revoke the full grant only while it remains
unused. The original grant and canonical usage are never edited.

Disputes are keyed by Stripe Dispute ID. Created or updated disputes establish
correlation but do not revoke credit until funds are withdrawn or the dispute
is lost. Withdrawn funds append a negative `dispute_adjustment` for the unused
remainder attributable to that purchase; reinstated funds append a positive
`dispute_adjustment` for what was actually revoked. Multiple disputes or
refunds for one payment must never revoke more than its unused grant.

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
- Checkout status is visible only to its authenticated payer.
- Webhook signatures and live Stripe re-fetch are both required.
- Logs and metrics use fixed status/reason codes and counts, not member IDs,
  payer identity, metadata payloads, receipts, or raw webhook bodies.
- Checkout creation is bounded per authenticated payer and request key; Stripe
  Radar and a reviewed operational velocity ceiling must be configured before
  production launch.
- Saved-card funding never accepts a browser-supplied PaymentMethod.
  For personal and Family purchases, Murph selects only the exact billing
  Subscription's attached explicit default or inherited Customer default,
  after matching the Subscription owner to the verified Customer. Unrelated
  Subscriptions never participate, and legacy default Sources stay in Checkout.
  Group funding may use the attached Customer default or sole attached card
  because it has no required billing Subscription, but it does not replace a
  legacy Customer default Source. The exact personal or Family billing
  reference is revalidated under the payer lock before bind; a mismatch cancels
  the unbound intent before Checkout. `allow_redisplay` is used only for Stripe Checkout
  presentation. Murph persists the resulting PaymentIntent before confirmation
  and never stores raw card details.
- Payment records and health-sharing permissions remain separate. Buying usage
  never grants access to another person's data.

## Group-Container Funding

An authenticated contributor opens `/groups/fund/[joinCode]`. Possession of the
group's existing opaque join code is the public targeting capability; no second
funding code or rotation policy exists. Web resolves the active group and its
synthetic member, shows only `healthy`, `low`, or `exhausted`, and presents
capped monthly sponsorship before the fixed $5, $10, and $20 one-time
contributions. Both explicit funding paths remain available at every capacity;
capacity expresses urgency and governs later automatic refill admission, not
whether someone may fund the group. The browser never submits payer or
beneficiary identity.

A group chat that has only ever talked to Murph has no `HostedGroup` row or
join code. Its funding URL uses a signed funding-only locator instead:
`gf1.<runtimeMemberId>.<hmac>` derived from the app-session HMAC key with a
dedicated domain separator. The locator is accepted only by the funding page
and checkout target resolution, resolves to the exact runtime member after
re-verifying the container and active access, and is rejected by every join
surface because it is not a join code. It writes nothing: no `HostedGroup`
row, membership, join code, vault-share projection, or profile-name/email
grant is created. Owner-created join codes keep funding exactly as before,
and enrollment stays behind the owner-minted join link.

An exhaustion notice may also use the signed locator for an owner-created
group so notice construction stays database-free. After authenticating that
locator, the funding page keeps the signed capability in its funding path,
client endpoints, and persisted return URL; it never reveals the durable join
code. The already-resolved synthetic runtime member is the exact group purchase
identity, so a purchase begun through either valid funding locator resumes
through the other. Payer, purchase kind, offer, request key, and Family group
identity checks remain exact.

The Stripe Customer belongs to the payer, never to the group owner or synthetic
container. Fulfilled credit belongs to the beneficiary. Payer departure and
beneficiary deletion therefore follow the separate lifecycle rules above.
Checkout status remains visible only to its authenticated payer; group state
does not expose contributors, receipts, cash value, or internal USD-micro
accounting.

Choosing a monthly maximum or one-time amount has no payment effect. The
explicit **Sponsor this chat** action authorizes the initial exact $5 purchase
and later exact $5 off-session purchases only when the existing group-capacity
owner requests them, never above the current period's maximum. The explicit
**Contribute $10** action authorizes only that one contribution. Murph uses the
payer Customer's attached default card, or its sole attached card. If there is
no canonical choice, Stripe Checkout collects a card. The monthly authorization
is capped auto-refill authority, not a fixed-price Stripe Subscription. Because
provider work happens after admission, the beneficiary-locked admission is the
linearization point for need and cap headroom. Its deterministic purchase is the
durable exact-$5 reservation. The later provider sweep rechecks the
authorization, period, cap, purchase identity, and runtime access without
holding a database transaction open across Stripe I/O or reinterpreting need
after admission. Any unused granted credit remains available across periods.

## Family Member Funding

The active owner chooses one active member from Family Settings and opens the
shared fixed-pack dialog. The member route is same-origin and authenticated;
the browser does not submit payer identity, group identity, price, grant value,
or Stripe Customer. Web binds the opaque member selector to the owner's active
roster before locking the beneficiary, then re-reads membership and member
eligibility under that lock. A foreign selector therefore cannot contend on or
fund an unrelated member.

Murph may deep-link the active owner's own seat with the stable
`/settings?addUsage=family#family` selector only after a current Family status
read proves owner, active billing, and exactly one active owner row. Settings
resolves that hint to the authenticated owner's current active group and seat;
malformed or repeated selectors, stale groups, inactive rows, and non-owners
open nothing. Other members remain selected inside authenticated Family
Settings. The purchase mutation repeats the full authorization regardless of
how the dialog was opened.

The purchase freezes the exact Family group and beneficiary in its
server-generated return URLs. This distinguishes an owner's personal target
from that same owner as a Family member and prevents a historical group from
being reinterpreted as a new Family relationship. Exact request-key replay may
recover status and cancellation after membership removal, but it rechecks
current Family authority before releasing payment capability; a fresh request
key also requires current authority. The service uses the same exact-target
capability projection again after Stripe returns and in ambiguous-provider
recovery before decrypting a Checkout URL or offering retry. If membership
changes while provider I/O is in flight, the bound purchase remains visible for
status and cancellation but exposes no payable capability.

Only one payer-wide nonterminal purchase may exist. While it does, Family
Settings hides every new amount picker and places recovery controls only on the
frozen member. Any request for a different personal, hosted-group, or Family
target receives a conflict with no Checkout URL and no resume or retry
capability, regardless of request order. The payer may inspect or cancel the
frozen purchase, and closing the conflict refreshes server state.

Personal Settings and hosted-group funding pages also read the payer-wide
active purchase before showing offers. The exact frozen target receives its
ordinary recovery controls; another target receives the shared status/cancel
conflict state with no amount picker, URL, or retry action.

The active-purchase server projection releases payment capability only when the
frozen target exactly matches a current server-approved target. If a Family
beneficiary is no longer in the roster, Settings shows status and cancellation
only; it does not decrypt or serialize the Checkout URL and does not offer
retry. Historical invite labels and contact hints never authorize payment.

## Operations And Reconciliation

The existing `HostedStripeEvent` receipt is the retry owner and records attempt
state, next-attempt time, and a bounded error code. Purchases use one status
lifecycle plus their provider references and last reconciliation time. Identity,
catalog, payment, duplicate-grant, negative-balance, and projection invariants
fail closed and leave the Stripe event retryable.

V1 does not add a second queue or a separate operator reconciliation service.
Operational checks should watch for paid purchases without grants, `created`
purchases left unresolved past their 90-minute expiry, direct group
PaymentIntents still bound in `payment_pending`, Stripe identity/catalog
mismatches, subscription dispatch of a one-time purchase, projection drift,
and negative-balance attempts. Any future operator command must re-fetch Stripe
and call the same idempotent reconciler by purchase ID.

## Rollout And Rollback

1. Configure and verify the one-time Product and four Prices, keep Stripe Tax
   disabled for this flow, confirm equal subtotal/total behavior, and verify
   payment settings, the direct PaymentIntent and Checkout webhook event
   subscriptions above, Radar rules, and environment mappings in Stripe test
   mode, then live mode.
2. During the Web predeploy, apply the expansion that makes the payer and its
   payer-encrypted Price and Customer references nullable, then apply
   `20260727040000_relax_hosted_usage_credit_detached_direct_proof`. The latter
   installs or replaces the two detached-payer checks before the new producer
   can serve traffic. Its fulfilled arm requires paid, terminal, reconciled,
   PaymentIntent, and Charge proof without requiring a Checkout Session, and
   its sibling check still clears every payer-encrypted Stripe value. Existing
   Web remains compatible because the new shape is a superset of its
   Checkout-backed fulfilled rows. Apply
   `20260727190000_hosted_group_sponsorship_moment` before enabling the
   sponsorship producer; older Web does not read or write the additive table.
3. Deploy the Cloudflare/runner bundle first. It parses the optional
   low-capacity and group-running-bit mailbox fields, recognizes the isolated
   `creative-response` and `creative-response-text` notification profiles, and
   advertises `read_usage`. Verify the exact runner fingerprint converges before
   Web can produce either new sponsorship contract. Existing Web sends neither
   sponsorship field during this compatibility window.
4. Apply the additive capped-sponsorship authorization migration and
   `20260807210000_add_group_sponsorship_creative_request` after the tolerant
   runtime reader is live. Confirm both migrations and compatible Web have
   converged before enabling monthly authorization creation, automatic refill
   admission, or optional creative-request creation.
5. Deploy Web next. It contains the group sponsorship producer, target-aware
   saved-card/Checkout flow, webhook-owned grant and moment materialization,
   bounded automatic-refill sweep, private management and notices, optional
   running-bit projection, and existing usage/exhaustion projections.
   The new stable hosted developer guidance deliberately
   changes the assistant contract fingerprint: every existing direct or group
   session that would otherwise use native resume starts one new provider
   thread on its first post-deploy conversation turn. That turn replays the
   committed transcript fallback, bounded to 24 messages, 4,000 bytes per
   message, and 12,000 bytes total; later turns resume the new thread. A rollback
   rotates sessions that already adopted the new fingerprint once more.
6. Do not run a second postdeploy constraint installer. The historical
   `20260720233000_hosted_group_usage_funding_invariants` contract migration is
   retained as immutable history but is superseded and omitted by the runner;
   reapplying it would incorrectly require a Checkout Session for fulfilled
   direct payments.
7. Before widening exposure, smoke one pre-existing healthy hosted session:
   its first turn must rotate and reply without low context, and its second turn
   must resume the new provider thread. Also smoke group funding, a paid webhook
   grant, the runtime recheck and subsequent usage debit, low direct/group
   next-turn context, the exhausted notice, payer deletion, and later
   negative/positive refund or dispute adjustments in Stripe test mode.

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

The first monthly authorization is the old-Web rollback floor because preceding
Web cannot activate or safely manage it. Recover from that point with a forward
fix on the compatible schema, Web, and runtime rather than restoring the older
producer.

The optional-creative Web producer is also an old-Web rollback floor.
Pre-feature Web does not understand the creative envelope and unconditionally
materializes a song for every fulfilled group contribution, including a quiet
one. Disable new sponsorship intake before rollback and keep the compatible Web
reader and reconciler deployed. Rolling below that floor requires proof that no
group contribution can still be materialized or retried; otherwise
forward-fix.

Funding-page recognition does not add another ciphertext-format rollback floor.
Apply `20260811160000_add_group_sponsorship_funding_alias_publication` before
promoting the recognition-aware Web artifact. The migration adds only nullable
consent and publication metadata, and the encrypted alias remains the same
bounded plain-text payload understood by preceding Web. Consent metadata is
also excluded from the legacy configuration digest, so base recovery of a
current-created consented row matches without changing its stored consent; a
base-created row cannot gain consent on retry. A base client sent to current Web
is accepted, but without the new consent field its alias remains Anonymous on
the funding page. A surviving current client sent to base Web is rejected by
the base strict request parser before Stripe; rollback must disable new
sponsorship intake and force a page reload before routing sponsorship requests
to base Web. Current-created pending moments remain recoverable and
materializable by base Web. Base settlement cannot stamp the new publication
metadata, so recognition remains Anonymous permanently even after a later
compatible settlement replay. This deliberately prefers the narrower privacy
fallback over retroactive publication. Purchased credit, creative
materialization, notifications, and funding recovery do not depend on that
optional publication marker.

## Verification

Current focused unit and component coverage exercises:

- the exact fixed offers, request parsing, direct-paid eligibility, durable
  pre-Stripe purchase row, stable idempotency key within the derived creation
  window, no-I/O cutoff, and active-purchase fence through expiry;
- group saved-card selection, create-before-confirm persistence, exact-intent
  retry after an ambiguous confirmation response, account-deletion-before-bind
  cancellation with no confirmation, verified cancellation before Checkout
  fallback, cross-offer recovery refusal, locked client amount/key, and
  first-time group card saving;
- payer-bound status and cancel-expiry routes, CSRF rejection, and paid-state
  precedence over cancellation, including sessionless direct cancellation from
  a target-conflict surface;
- grant/debit replay, included-first FIFO settlement, crossing overrun, capped
  signed refund/dispute adjustments through fake Prisma transaction clients;
- real PostgreSQL grant replay, beneficiary-before-purchase lock ordering,
  grant/debit serialization, and deletion-first cleanup against a guarded
  isolated database;
- live-state Stripe reconciliation through mocks, including paid, delayed,
  failed, expired, direct saved-card success/processing/late terminal events,
  retryable unbound success events, Checkout-free refunds, payerless direct
  refunds/disputes, spoofed-Price, `charge.refunded` provenance, and
  one-time-versus-subscription dispatch cases;
- composed usage blocking, carryover credit, trial and group behavior, and
  current-period block clearing; and
- the Settings dialog's no-default selection, exact offer post, payer-and-target
  session-stable key retry across remount and same-tab account switching, group
  payment-ambiguity copy and amount lock, redirect, read-only return polling,
  cancel expiry, and delayed state;
- group funding target resolution, active-runtime eligibility, fixed-pack
  checkout without an individual paid plan, target-aware replay/conflicts, and
  reuse of the same dialog state machine;
- Family owner/member authorization, exact target freezing, former-member
  status/cancel-only recovery, all ordered target-conflict payment suppression,
  and payer-wide single-active purchase presentation;
- group usage reads with only funding urgency and the first-party URL,
  automatic-refill suppression while low, ordinary low-capacity next-turn
  context once automatic recovery is unavailable, and one route-authorized
  exhaustion message with the funding link and no payer or accounting detail;
  and
- cross-owner deletion plus payerless terminal refund/dispute reconciliation.

These suites do not prove a real Stripe test-mode webhook or deployed browser
behavior. Release verification therefore still needs the scoped web tests and
typecheck, desktop/mobile browser proof, and a Stripe test-mode paid Checkout
plus webhook smoke.

## Non-Goals

The implementation does not add arbitrary amounts, a fixed-price Stripe
subscription, uncapped recharge, multiple simultaneous automatic sponsors,
discounts, transfers, cash redemption, public payer attribution, a Family or
group wallet, Stripe Meter reporting, or a second usage/accounting service.

## Rejected Alternatives

- **Stripe Billing Credits:** limited to eligible metered subscription items
  reported through Stripe Meters and applied when invoices finalize. It does
  not match Murph's existing immediate usage allowance.
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
- [PaymentIntents create API](https://docs.stripe.com/api/payment_intents/create)
- [PaymentIntents confirm API](https://docs.stripe.com/api/payment_intents/confirm)
- [Save payment details during payment](https://docs.stripe.com/payments/save-during-payment)
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

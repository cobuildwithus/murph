# Hosted Family Plan

Last verified: 2026-08-10

## Purpose

Hosted Family is the reserved-seat billing and access layer for inviting close
family members into Murph without making them manage Stripe checkout. It should
feel like Spotify Family for access, but keep Signal-style privacy for health
data and conversations.

Family supports 2-6 sponsored people. The owner counts as one sponsored person.
One Family subscription can reserve an exact mix of Pulse seats at
$7/person/month and Edge seats at $19/person/month. Each member and pending
invite has one assigned tier. Each active member's individual monthly usage
allowance is 80% of that assigned seat price: $5.60 for Pulse and $15.20 for
Edge.

## Product Contract

- One owner pays for the hosted Family plan.
- A Family owner is a real hosted member. A synthetic group-chat thread container cannot own a Family plan, inspect Family account state, begin checkout, or issue invites; those operations belong in a participant's private Murph conversation. This invariant is enforced at canonical group creation and billing authorization and is rechecked before checkout redirects or Stripe reconciliation can bind or activate Family billing state; assistant-tool guards are only an earlier user-facing rejection.
- The owner buys 2-6 reserved sponsored seats in an exact Pulse/Edge mix.
  Active members and pending invites consume capacity from their assigned tier.
- Family members receive sponsored hosted access while the plan and their
  membership are active.
- Every sponsored member gets a member-level usage allowance equal to 80% of
  their assigned tier's recurring seat price. There is no shared Family usage
  pool. A member keeps any higher allowance already granted for an authoritative
  open paid billing period until that period renews; a tier or direct-to-Family
  billing-mode change still reconciles immediately. The rollout predeploy
  migration materializes missing rows only for valid current paid billing
  bounds before the new allowance code is promoted. It skips mutable calendar
  fallbacks and never rewrites existing spend.
- The active owner may buy one fixed $5, $10, or $25 usage-credit pack for one
  exact active Family member. The owner pays and that member alone receives the
  credit.
- An active Family Edge assignment unlocks Edge model choices, including Sol;
  a Family Pulse assignment does not.
- Every family member remains a separate `HostedMember` with their own routing,
  mailbox, workspace/runtime state, legal consent, export, and deletion rights.
- The owner can see seat and setup status, such as invited, joined, messaging
  connected, or removed.
- The owner cannot see family members' private messages, vault data, wearable
  data, mailbox content, outcome cards, runtime logs, or browser-vault exports.
- Removing a family member revokes sponsored access only. It does not delete
  the member's account, historical data, consent history, routing rows, or
  export/delete rights.

Family membership is an entitlement source, not a data-sharing relationship.

## Non-Goals

Do not add in the MVP:

- shared family health dashboard
- family-owner access to raw or summarized health data
- child/minor accounts or parental health-data authority
- family-level mailbox, shared assistant runtime, or shared vault
- automatic challenge sharing
- owner approvals or shared allowance transfers
- self-paid Family hybrid membership in v1

Sharing health data belongs to future scoped challenge consent. Family plan
membership alone must not grant health-data sharing.

## Seats And Billing

The Family plan is per sponsored seat and tier:

- minimum 2 sponsored people
- maximum 6 sponsored people
- the owner counts as one sponsored person
- active memberships plus pending invites assigned to a tier must not exceed
  that tier's paid quantity

Stripe owns the subscription, invoices, payment method, renewal state, and seat
quantities. One subscription contains at most one licensed monthly item for
each supported Family tier. Murph stores only the hosted read model needed for
entitlement, settings display, and reconciliation: customer id, subscription
id, current billing phase/period, a per-tier capacity projection, and the
legacy total/item fields needed while existing Pulse-only subscriptions roll
forward.

Internal Family MRR derives from the same per-tier projection and each tier's
Family offer price. Do not multiply the aggregate seat count by the Pulse
price once mixed-tier subscriptions exist.

Do not introduce generic plan-transition machinery or a second durable billing
operation owner. Family checkout, invites, and member-level plan changes update
the exact Stripe item composition. The owner-facing settings surface manages
people, not seat quantities. Webhook reconciliation remains the only writer of
the local paid-capacity projection. Direct Pulse and Edge billing continue to
use the existing member billing path.

When an owner converts an existing direct-paid subscription, the request only
updates Stripe and reports that Family billing is syncing. The Family
subscription webhook writes the paid projection and clears the old direct
billing reference in the same transaction, so entitlement ownership changes
once and never advances Stripe's event watermark from local wall time.

Converting an active direct Pulse trial is a consequential billing action: it
ends the free trial and starts the two-seat Family minimum immediately. Settings
must show the exact $14/month total, $7/person Pulse price, two included seats,
and immediate trial end in a confirmation dialog before sending the request.
Keeping the trial sends no request. The server requires the explicit
trial-conversion confirmation and rejects an old or crafted client that omits
it before any Stripe mutation. The confirmed conversion updates the existing
trial subscription rather than creating a competing subscription; webhook
reconciliation remains the projection owner.

Changing a member's tier is one owner-confirmed action. Web records the target
in the membership's nullable `pendingPlanCode` while the current tier and access
remain active, then swaps the source and destination quantities in one
serialized Stripe subscription update. The subscription webhook accepts that
pending intent only when the incoming quantities equal the exact one-member
swap from the current paid projection; it then writes the member tier and paid
projection in the same transaction and clears the pending value. This one-field
bridge is required when all six Family places are occupied because a temporary
seventh paid place is invalid. Retries reuse the same pending intent and Stripe
idempotency key. The request path never writes paid capacity.
While that intent exists, Settings labels the member as updating and disables
further plan or removal actions until the webhook clears it.

Member plan swaps use Stripe prorations on the next invoice: upgrades add the
prorated difference and downgrades add the corresponding credit. The owner sees
the target per-person monthly price before confirming.

Explicit capacity changes use `always_invoice` for both increases and
reductions so Stripe records the resulting charge or credit on an invoice.
Increases also fail if immediate payment cannot complete. A reduction must not
use `proration_behavior: "none"` because that silently discards the owner's
mid-cycle credit.

Core invariant:

```ts
activeMembershipCount[tier] + pendingInviteCount[tier] <= billedQuantity[tier]
```

## Member Usage Top-Ups

Family Settings composes the existing usage-credit dialog and purchase
lifecycle. It does not add a Family wallet, shared balance, transfer, catalog,
ledger, webhook path, or accounting owner. The browser chooses an active member
row and submits only the existing opaque offer code and request key to that
row's authenticated same-origin route.

For the active owner's own seat, the Settings AI-usage row exposes that same
Family-targeted dialog directly, including when usage is exhausted. The stable
`/settings?addUsage=family#family` handoff opens this visible dialog after
revalidating the current owner row. Other Family members remain selected from
their authenticated management surface.

Web authorizes the payer as the current active group owner, resolves the exact
selected beneficiary from that owner's active roster, rejects suspended or
synthetic members, and requires the active Family billing projection. The
purchase uses the canonical Family-group Stripe Customer. The owner remains
the payer and the selected member is the sole credit beneficiary; buying usage
never grants the owner access to that member's data.

One payer may have only one nonterminal usage-credit purchase across personal,
group, or Family targets. The purchase freezes its exact Family group and
beneficiary before provider I/O. An exact request-key replay may recover that
purchase's status after the member leaves, but every payable replay and every
fresh request must pass current Family authority. While any purchase is active,
every other Family member's Add usage
action is hidden. A request for a different member cannot resume, retry, or
follow the existing checkout URL; it may only inspect or cancel the payer's
frozen purchase and refresh the server projection.

The frozen target also owns Settings recovery when the payer's billing mode
changes. In particular, a personal purchase started before direct-to-Family
conversion keeps its personal Checkout URL, retry capability, polling, and
return owner until it becomes terminal. A new owner-seat Family purchase
returns to `#subscription`, where its meter and dialog live; another member's
Family purchase returns to `#family`. Target reconstruction continues to read
older owner-seat Family URLs that used `#family`.

An exact returned purchase exclusively owns its dialog state. A newer active
purchase for another beneficiary stays on that beneficiary's frozen-target
surface and cannot supply conflict, capability, or completion fields to the
returned purchase.

Once a beneficiary leaves the active roster, the former-member purchase remains
inspectable and cancelable but is never payable from Settings: the server does
not release its Checkout URL or retry action. Historical invite labels and
contact hints do not restore payment authority because they are not unique
beneficiary identity.

## Deployment Order

The hosted-execution response parser is backward compatible with the old
Pulse-only web response, but the old parser rejects the new `plans` and
`planCode` fields. Deploy Cloudflare hosted execution first with immediate
runner-container rollout, verify the new bundle is serving, and then deploy
hosted web. Hosted web predeploy applies the nullable/defaulted assignment
columns, nullable pending-plan column, and empty capacity table before the new
web build. Existing Pulse-only groups read through the live legacy billed total
until the first new webhook atomically writes exact tier rows. The new member
management UI must not receive traffic until the webhook build that understands
`pendingPlanCode` is live. The post-deploy contract lane adds assignment
constraints only after the prior web-function window drains.

Configure both Family Stripe price ids before exposing Edge capacity. After
web deploy, reconcile one Pulse-only subscription and one mixed Pulse/Edge
subscription, then verify settings quantities, member allowances, and Family
MRR match the Stripe items.

## Data Ownership

Hosted Family state lives in `apps/web` Postgres as hosted product/control
state. It is not canonical local-vault health truth.

The clean model is:

- `HostedAccountGroup`: the family group and owner.
- `HostedAccountGroupMembership`: one member's role and access state in the
  group, including their assigned tier.
- `HostedAccountGroupInvite`: a scoped invite into the group, including the
  tier reserved if it is accepted.
- `HostedAccountGroupPlanCapacity`: the Stripe-derived paid quantity for one
  supported tier.
- `HostedAccountGroupBillingRef`: the Stripe-derived read model for the family
  subscription.

Use account-group naming in code where practical so product-facing "Family"
does not collide with existing vault `family` record families.

## Entitlement

A hosted member has active access when either:

- their existing direct hosted billing status grants access, or
- they have an active family membership in an active family group whose billing
  state grants access.

`hosted_member.billing_status` records only the member's own Stripe
relationship; sponsored access is derived, never materialized onto the member
row. The single derivation owner is
`apps/web/src/lib/hosted-onboarding/member-access.ts`
(`hasActiveHostedMemberAccess` / `readActiveHostedMemberAccess`); every access
gate (webhooks, runtime, pages, internal routes, egress, thread containers)
must use it. The own-billing predicates in `entitlement.ts` are reserved for
billing surfaces that genuinely mean "this member's own subscription".

Sponsored access must fail closed when:

- the family subscription is canceled, unpaid, paused, suspended, or otherwise
  inactive,
- the member is removed from the group,
- active memberships exceed paid capacity for any assigned tier — enforced at
  write time: invite issuance/acceptance assert tier fit, and the subscription
  webhook fails the whole group to `unpaid` when active members exceed a paid
  tier quantity (reads trust that invariant instead of re-counting capacity per
  access check),
- the membership is not accepted/active, or
- required launch/legal consent is missing at the boundary that requires it.

Privacy access for export and deletion must remain available under the existing
privacy rules even after sponsored access is revoked.

Active Stripe reconciliation reads a bounded candidate set of at most six
active members and prepares any missing domain-root candidates sequentially
before the owning transaction. A fully rootless six-member group therefore has
a maximum candidate-generation fanout of 42 provider calls: three encryptions
and four signatures per member, with at most four concurrent calls inside one
member's preparation. The transaction then revalidates billing, sponsorship,
capacity, membership, and direct-paid authority before committing candidates
and activating members sequentially. A member that appears after preparation
has no matching candidate and fails with the typed required-candidate error;
the retry prepares from the new authoritative snapshot instead of signing
under the transaction. Preparation includes every active member because the
locked owner must distinguish an owner handoff from a sponsored-member direct
subscription race without signing under the transaction.

Activation still performs the separate control/ingress prewarm decrypts while
the owning transaction is open. At six members those twelve decrypts bring the
complete fully-rootless activation path to at least 54 provider calls, although
only the 42 candidate-generation calls now run before the transaction. The
per-domain advisory locks are transaction-scoped, so post-commit prewarm work
inside the same transaction also extends their lifetime.

A live Family owner—an active sponsorship, a bound subscription, or any
persisted checkout attempt—prevents a member from starting a separate direct
checkout. An exact expired-Session event clears only the matching Family
attempt. Family reconciliation projects Stripe `canceled`
and `incomplete_expired` subscriptions into the existing terminal canceled
group status, clears the current Family subscription/item binding, and keeps the
customer plus event freshness watermark so both direct and Family checkout can
recover without allowing an older event to reclaim billing. An older unbound
attempt remains an ambiguous claim and requires support rather than permitting
a blind second provider start. A non-owner sponsored member may not retain a bound live direct subscription.
Invite acceptance rejects that state with the existing recoverable transfer
error. If Family sponsorship and direct Checkout race, the locked Family claim
wins without disabling sponsored access, and every Checkout, subscription, and
invoice replay for the different personal subscription remains in the existing
receipt-owned cancellation path until Stripe confirms terminal cleanup. The
owner exception remains limited to the exact direct subscription being handed
to the Family group.

If a direct checkout opened before Family billing claimed the member and
completes afterward, reconciliation leaves it unbound and cancels that
superseded subscription after the database transaction. When the exact owner
subscription has since been handed to the Family group, its immutable direct
Checkout replay is a no-op: the current Family group subscription binding
proves that it is the same provider identity, so reconciliation neither
recreates individual billing nor cancels/refunds the Family subscription. A
different direct subscription remains a cleanup candidate. Duplicate cleanup
automatically refunds only one provable paid invoice and completes only after
Stripe reports the full refund `succeeded`; balance credits, credit notes,
partial or pending refunds, multiple paid invoices, and multiple payment
allocations remain retryable or require support instead of guessed accounting.
A Family conversion may clear an owner's prior direct billing reference only
when it names the same Stripe subscription that became the Family subscription;
never erase a different subscription reference.

## Non-obvious Affected Surfaces

Terminal direct-to-Family reconciliation changes the owner's own billing status
to `not_started`, so dashboard authentication intentionally redirects Settings
returns to `/join`. The matched authenticated invite flow must distinguish this
existing canceled Family group from ordinary first-time onboarding. With no
current Family Checkout claim, `/join` offers the existing Family Checkout
action beside the individual plans. With a current Family attempt, it offers one
Family continuation action through the existing idempotent Checkout route and
withholds individual Checkout actions. A bound Family subscription shows
persistent syncing feedback until reconciliation closes the claim. Existing
invite-status polling also refreshes these server-derived states, so an
authoritatively expired Session returns to plan choice and a reconciled
subscription advances the journey. Ordinary members without a canceled owner
group retain the existing Pulse and Edge onboarding journey.

A persisted attempt remains a billing claim until Stripe proves its exact bound
Session expired. The existing Family action retrieves a bound Session: it
revalidates the exact attempt and Session under the owner lock after provider
I/O, resumes an open Session, synchronously applies a completed Session through
the existing reconciliation owner, and clears then restarts only an exact
expired Session. If active or terminal subscription reconciliation wins during
provider I/O, the continuation action preserves that authoritative result
instead of rebinding stale Checkout state. A delayed expiry event remains scoped
to the old attempt and Session key. An unbound attempt may reuse its original
idempotency key only within the existing 24-hour safe-replay window; after that
window it fails closed to support because a previous provider start is
ambiguous. Once Checkout binds a subscription, that binding continues to claim
the member even while the canceled group awaits subscription reconciliation;
authoritative terminal reconciliation clears the binding and releases the
claim.

Cancel returns through Settings and dashboard auth to the resumable `/join`
state. Success instead carries the bounded Stripe Session ID through `/join` to
the existing invite success surface, which verifies Session ownership and
reconciles it while the owner is present rather than showing the continuation
action while webhook processing is delayed. The short Family Checkout redirect
branches on Stripe Session status: `open` requires a provider URL, `complete`
preserves the claim and enters that verified success surface, and only exact
`expired` clears the matching attempt. Missing URLs, unknown status, and
retrieval ambiguity preserve the claim and fail retryably. A `complete` Session
that does not yet expose its subscription identity also keeps the exact attempt
and Session binding while success polling waits; only the same completion with
the canonical subscription identity may replace that claim with the
subscription binding.

Regression coverage follows the production boundaries: terminal-before-active
Stripe reconciliation releases the exact direct binding, dashboard auth returns
the owner to `/join`, the server model derives recovery from the owner group,
the rendered surface posts Family continuation to the existing Settings billing
route, the provider request keeps its idempotency key and Settings cancel return,
bound Session status is authoritative for resume/reconcile/restart,
and invite-status polling rereads the server projection while Checkout or
reconciliation remains pending.

## Invite Issuance

The owner can issue family invites from the web settings surface and through the
normal Murph assistant channel. Chat issuance should support requests like:

```text
invite my mom, her phone number is +48..., her Telegram is @...
```

The assistant should resolve the request into a bounded invite command owned by
hosted web. The command should create or reuse a scoped family invite while
respecting the paid-seat invariant. If no paid seats are open, the owner must
add a Family seat before issuing another invite.

Accepted invite targets:

- phone number for phone-bound flows
- Telegram username for a convenience fallback when Telegram strips the deep
  link start payload
- optional display label such as "Mom" for owner-facing seat status

Do not treat a Telegram username as durable identity proof. Usernames can
change and a bot generally cannot initiate a private chat with an arbitrary
username unless that Telegram account has already started the bot or is
otherwise known. When the owner pre-binds an invite to a Telegram username,
store only the encrypted username plus blind index needed to match the inbound
Telegram `from.username`.

## Invite Acceptance

The simplest acceptance path should be chat-first.

Binding is optional targeting, not mandatory verification. A phone-, email-, or
Telegram-bound invite can only be claimed by that matching identity. A fully
unbound label-only invite is claimable by the first verified identity that
presents the invite reference through an explicit act: sending the
`family_<code>` message by text, opening the Telegram bot deep link, or tapping
Accept after web sign-in. Acceptance must never happen as a side effect of an
unrelated message, and the `family_<code>` token remains the messaging consent
marker.

The web accept page (`/family/accept/<code>`) selects the accept channels from
the invite binding. Bound invites never offer channels other than their
binding; unbound invites offer all configured claim channels. When an unbound
invite is claimed, notify the plan owner that the label, or "Someone" when no
label exists, joined the family plan.

### Telegram

Telegram invites use a deep link such as:

```text
https://t.me/<bot>?start=<family-invite-token>
```

The hard binding is the Telegram user/chat identity observed when the invitee
clicks the deep link and starts the bot, or an already-known Telegram route.
Some Telegram clients open the bot with a plain `/start` instead of preserving
the deep-link payload. In that case, if the inbound `from.username` matches
exactly one non-expired pending invite that was pre-bound to that username,
accept that invite without requiring the user to paste a token. If the match is
missing or ambiguous, fail closed rather than guessing.

### iMessage / SMS

A phone pre-bound invite opened on the web accept page leads with a "Continue in
Messages" action: an `sms:` deep link to Murph prefilled with the family invite
token embedded in a human-readable sentence. Sending it reuses the same inbound
phone-bound acceptance path, so the invitee joins from the thread they already
use with no separate web sign-in or verification step. Prefer the Murph line an existing
member already messages on so acceptance lands in their current thread instead
of being redirected to their home line; fall back to a configured line for a
brand-new invitee, whom the webhook assigns a home line on first contact.

### Web Fallback

Web remains a fallback for unsupported verification, settings, wearable
connection, export, deletion, and other account management tasks. The family
MVP should not require a web visit for a straightforward Telegram or
Messages invite acceptance. For unbound invites, a signed-in hosted member may
tap Accept on the web page, and their verified phone or email identity becomes
the claimant. For bound invites, the server rejects a mismatching verified
identity before crypto preparation and repeats the same binding assertion
inside the claim transaction, so provider failure cannot replace the actionable
identity error and a concurrent retarget still fails closed. After that binding
check, the server also rejects a missing, inactive, or expired invite before
crypto preparation. An already-accepted replay for the same member skips
preparation. The claim transaction remains authoritative and repeats binding,
state, expiry, target, seat, and claim checks against concurrent change.

## Acceptance Copy

Invite acceptance must explicitly state:

- who invited the person,
- that the owner pays for hosted access,
- that the invitee gets a private Murph account, and
- that the owner cannot see private messages or health data.

Keep the copy plain and non-promotional. Example:

```text
Your family plan owner invited you to Murph Family. They pay for access, but
your Murph messages and health data stay private to you. Join?
```

The implementation should render the inviter name from stored display context
when available and fall back to "your family plan owner" when not.

## Removal

Owner removal should:

- mark the membership removed,
- revoke sponsored entitlement,
- leave the member's account and data intact,
- keep privacy export/delete paths available, and
- avoid sending automatic health-context messages outside the normal
  AI-gated or reviewed product-copy surfaces.

The removed member may later start their own direct paid plan through the
existing billing path.

## Export And Deletion

Hosted account export and deletion must include enough family metadata to
explain access state without leaking other members' private data.

An owner's export may include:

- group id/status,
- role,
- seat count,
- invite metadata without active invite tokens,
- membership status rows with minimized display labels.

A member's export may include:

- their own membership status,
- owner/group display context needed to explain sponsored access.

Exports must not include other members' contact lookup keys, raw phone numbers,
Telegram ids, private routing ids, mailbox payloads, health data, or runtime
state.

Deleting a member removes their membership row by cascade or explicit cleanup
but must not delete the family group unless they are the owner and the product
has a documented owner-deletion policy. The MVP should fail closed and direct
owner deletion through the existing account deletion flow plus explicit family
billing cancellation/transfer policy rather than silently orphaning sponsored
access.

## Privacy And Security Invariants

- Family ownership never implies read access to another member's private data.
- Invite tokens are scoped, expiring capabilities and must not be logged or
  exported while active.
- Contact values are encrypted/blind-indexed following existing hosted contact
  privacy patterns.
- Messaging provider credentials remain Worker/provider owned; hosted runtime
  receives no raw provider secrets.
- Family entitlement checks should be explicit and test-covered at access
  boundaries instead of inferred from unrelated billing status.

## Implementation Phases

1. Add the spec, data model, store helpers, and entitlement tests.
2. Add per-seat Family billing checkout/reconciliation for the owner group.
3. Add invite issuance and acceptance primitives for web/assistant-owned
   commands.
4. Add Telegram deep-link and phone pre-bound acceptance flows.
5. Add the smallest owner-facing management UI needed to invite/remove members.
6. Add export/delete coverage and direct privacy proof.

Each phase should preserve the existing HostedMember boundary and avoid adding
generic account-management abstractions before the reserved sponsored-seat model
proves insufficient.

# Hosted Plan Usage And Subscription Actions

Last verified: 2026-08-18
Status: Implemented current-state contract

## Goal

Give a member one honest view of all currently available AI usage, block new
usage-bearing work when included allowance and usage credit are both exhausted,
and let a private Murph conversation carry out the smallest billing action the
member clearly chooses. Settings and Murph's read-only plan-usage tool consume
the same web-owned projection. Stripe and the existing web billing services
remain the payment system; Murph owns allowance and usage-credit capacity.
The personal, Family-member, and group top-up implementation contract lives in
`agent-docs/product-specs/hosted-usage-topups.md`.

## Ownership

`apps/web` derives the projection from the existing allowance resolver and
hosted usage ledger. It also selects any billing action shown to the member.
The projection is a read: it does not write a forecast, query Stripe, create a
usage period, or change billing state.

Usage credit stays separate from the included-allowance period in storage and
consumption order. The append-only credit ledger stores purchase and referral
grants as the canonical source, and the compact member balance/version remains
its bounded admission projection. The plan-usage read combines current-period
spend with every unit of capacity the gate says remains, so Settings and the
assistant receive one overall percentage without receiving internal allowance,
credit, or source-split values. The response may recommend the authenticated
Settings top-up handoff, but it cannot create Checkout or grant credit.

The growth dashboard's tracked fulfilled-top-up total has a different,
company-wide scope. One anonymous singleton count is seeded from retained
fulfilled purchases while the purchase table is locked at tracker cutover. A
database trigger is installed before the lock is released and increments the
count inside each later first successful purchase-status transition to
fulfilled, including while warm older Web bundles drain. Purchases deleted
before cutover cannot be reconstructed from the local database, so the
dashboard calls this a tracked total rather than complete lifetime history. The
counter stores no member, purchase, Stripe, event, or timing reference, survives
later account deletion, and is not billing or credit authority. Purchase rows
and ledger entries keep their existing member-scoped deletion behavior.

`@murphai/hosted-execution/plan-usage` owns the strict transport contract.
Cloudflare carries that contract over the existing signed `web-control.worker`
boundary through `planUsageToolPort`. Assistant runtime passes the semantic
port into assistant-engine, which advertises `murph.plan_usage` only when the
port exists. The original empty request remains valid and keeps the original
response shape. The current runtime opts into a nullable
`subscriptionActionQuote`; Web omits that field for callers that do not request
it. Billing truth and mutation authority stay in `apps/web`.

`@murphai/hosted-execution/subscription` owns the separate strict action
contract. Cloudflare carries it through `subscriptionToolPort` over the same
signed callback boundary. Assistant policy requires an explicit, unambiguous
current-turn choice before invocation. The runtime attaches the current
eligible accepted private input id, and the model selects only a bounded
action. Web binds that action to the callback member and live input before it
atomically claims the first subscription action on the existing mailbox row
and revalidates the current plan and action eligibility. The exact same action
may replay, but a different action for that input fails closed. This binding
proves current authority and provenance; it does not semantically interpret
the member's text. The runtime never receives Stripe credentials or derives
billing state. The nullable claim is operational metadata with the mailbox
row's existing retention, not a new billing owner or action table.

## Status Semantics

The available projection keeps these access states distinct:

| Access | Display plan | Period | Thresholded recommendation |
| --- | --- | --- | --- |
| Direct starter | Starter | Lifetime | Start Core when eligible, otherwise Pulse |
| Direct paid Group | Group | Monthly | Upgrade to Pulse |
| Direct paid Pulse | Pulse | Monthly | Add usage when configured and eligible |
| Direct paid Edge | Edge | Monthly | Add usage when configured and eligible |
| Sponsored member | Family | Monthly | None |

An active sponsored member keeps their assigned Family tier when the local
Family billing projection is absent, invalid, or lacks a period containing the
usage timestamp. Only a valid paid Family projection supplies period bounds;
otherwise the shared allowance resolver uses its existing UTC calendar-month
fallback, just as it does for direct paid plans. Already-accounted fallback
usage is not moved between periods later.

Synthetic group-thread allowance is not personal plan usage. It returns the
unavailable reason `group_not_supported` before exposing personal usage facts.
Inactive hosted access returns an explicit unavailable state. Starter access is
available or exhausted solely from its lifetime credit balance; account age and
historical trial timestamps are not availability inputs.

Every newly created Linq or Telegram group thread starts with a persisted $7.50
included-usage limit. This is prospective: existing group-thread rows keep
their stored limit.

Usage is normalized capacity across models and modalities. It is not a token
count or cash balance. Used and remaining percentages are bounded integers that
sum to 100. The display window starts at the current allowance period or, when
later, the beneficiary's latest fulfilled purchase grant in that period. Its
denominator is counted usage since that window began plus every unit of
effective capacity still available from the plan and generic usage credit. A
fulfilled top-up therefore starts a fresh 0%-used display; later counted usage
advances that meter. Settings still exposes neither the exact usage-credit
balance nor the internal included-allowance value. At a monthly reset, period
spend returns to zero, the plan allowance replenishes, and unused usage credit
remains available. The operation that crosses effective capacity may finish,
but subsequent usage-bearing work blocks and accepted conversation input
remains pending.

An automatic same-period increase in included allowance, including trial to
paid Pulse, Group to Pulse or Edge, direct Pulse or Edge to Max, and lower
Family tiers to Edge or Max,
starts a new capacity epoch at zero included spend. The canonical period stores
that cutover and the highest plan tier already granted during the period.
Consequently a downgrade followed by a re-upgrade cannot mint the same reset
twice. Usage whose provider work started before the cutover may arrive after
reconciliation; its immutable usage and pricing history remain, but it is
marked uncounted and cannot consume the new included allowance or purchased
usage credit. Provider work that starts after the cutover counts normally. The
meter uses the later of this cutover and the latest fulfilled purchase grant,
so it displays the fresh capacity immediately and does not forecast from
pre-reset work. A committed direct or Family capacity increase carries only the
affected member identities to the existing post-commit runtime-recheck owner.
A failed wake leaves the Stripe receipt retryable; replay re-proves the exact
billing transition, preserves the idempotent reset, and retries the wake rather
than waiting for the former period end.

For paid access, the included monthly usage value is exactly 80% of the
server-owned recurring amount for that member's billing mode and tier. Direct
Group, Pulse, and Edge therefore include $2.80, $6.40, and $16.00 from their
$3.50, $8, and $20 prices; direct Max includes $40.00 from its $50 price.
Family-sponsored Pulse, Edge, and Max members separately receive $5.60, $15.20,
and $39.20 from their $7, $19, and $49 seat prices. Discounts, taxes, prorations,
trials, and usage credit do not redefine this catalog-owned allowance.
An authoritative paid billing period that is already open keeps the higher
included limit granted before this policy change. The price-derived allowance
starts on its next paid period; an actual plan, Family tier, or
direct-to-Family billing-mode change still reconciles during the current
period. The rollout's predeploy data migration materializes a missing
legacy-limit row only when the direct or Family paid projection supplies valid
current bounds. It skips calendar fallbacks because their temporary key can be
replaced by a delayed billing projection without a renewal. Existing allowance,
spend, and future periods remain untouched.

A forecast requires at least 24 hours of counted usage in the current display
window. It uses the same overall effective capacity as the percentage and is
available only when that window's observed pace projects exhaustion before the
current period ends. The forecast is conservative and optional. It may inform
`recommendedAction`, but Settings does not display an estimated number of days
remaining.

## Actions

`apps/web` may return `recommendedAction` only when all available usage is
exhausted, the forecast projects exhaustion, or at least 80% of overall
available usage is used. Starter access may recommend beginning the current eligible paid plan. Paid
Group may recommend Pulse. An eligible
direct paid Pulse or Edge member may receive **Add usage**, which opens the
authenticated fixed-pack Settings dialog. Group does not expose personal
top-ups. Plan changes remain on the plan card. Family and group contexts do not
receive a personal top-up recommendation.

An explicit request for the personal top-up page is not a recommendation. After
a current `paid` read, the assistant may provide
`/settings?addUsage=true#subscription` even below the proactive threshold.

An opted-in `subscriptionActionQuote` answers a different question: what are
the current terms for the exact plan and timing the member asked about? Web
resolves that quote even below the usage threshold and without a Settings URL.
The signed quote binds the bounded action, member, target plan, timing, exact
catalog price, expiry, and current billing-state fingerprint. It may be null
when the action is ineligible. It is neither a recommendation nor consent, and
it does not weaken the explicit-confirmation rule.

Home and `murph.plan_usage` render only `recommendedAction`. Settings may expose
**Add usage** at any utilization for an eligible direct paid member, using the
same server-projected offers. Settings does not render `change_plan` from the
usage projection or ask that projection to resolve subscription actions; its
plan cards own those choices and confirmations.
Subscription actions still use the existing server-authorized billing route;
**Add usage** uses the authenticated one-time Checkout route described in the
top-up spec. Assistant policy uses a matching `subscriptionActionQuote` only to
disclose current terms before seeking an explicit choice. The read-only
`murph.plan_usage` tool cannot start checkout, upgrade a plan, grant credit, or
claim that a billing change happened.

When authenticated Settings opens the exact usage-recovery destination, its
existing plan visibility and eligibility facts may promote the next eligible
recurring tier as the primary recovery action. Starter chooses the first
visible paid plan, direct Group, Pulse, and Edge choose the next eligible tier,
and Max has no higher recurring action. A Family owner may likewise be offered
the next eligible tier for their own seat. Settings derives these actions from
its plan-card authority rather than from `subscriptionActionQuote`; the quote
remains disclosure for an exact assistant-mediated choice, not a
recommendation. An eligible one-time usage purchase remains secondary when a
higher recurring tier exists and becomes primary only when none exists.
The recovery query requests presentation; it is not proof that usage remains
exhausted. Authenticated Settings auto-opens recovery only while the live usage
projection is `exhausted`. An exact returned or nonterminal usage purchase owns
presentation before plan or Family recovery, preserving its frozen-target
resume, cancel, retry, polling, failure, and completion surfaces across later
billing-relationship changes. While the live projection remains exhausted, an
exact successful return keeps that purchase dialog visibly open through
confirmation and completion; Settings may use quiet successful-return handling
only beside a recovered, non-exhausted meter. Active, unavailable, reset, or
otherwise recovered usage ignores a stale recovery query.
An eligible Family-owner recovery banner follows that same current exhausted
state during both ordinary and message-linked Settings visits; the exact query
controls only whether its confirmation dialog opens initially.

Family Settings may expose the same fixed-pack dialog beside each active member
to the current active owner. That owner pays through the Family billing
customer and the selected member alone receives the credit. This is account
management, not a sponsored member recommendation, personal top-up, shared
Family pool, or transfer.

An explicit request in a private conversation to manage billing, or to perform
a Family account change outside `murph.family_plan`'s status, checkout, invite,
and member-usage navigation rules, may receive the canonical
`/settings#subscription` handoff
after `murph.plan_usage` returns `active` or `exhausted`. This is neutral
browser navigation, not a projected
billing action or recommendation. The assistant must say that no billing or
Family change happened. It must not provide the private management handoff for
`group_not_supported` or `hosted_access_inactive`, or offer it proactively.

### Private Conversation Actions

`murph.subscription` exposes one signed `change_plan` action to the model. It
supports:

- a Starter member beginning an eligible paid direct plan through ordinary
  Stripe Checkout;
- immediately upgrading Group to Pulse or Edge, or Pulse to Edge; and
- scheduling paid Pulse or Edge to change to an eligible lower direct plan at
  renewal.

These are member-directed actions, not extensions of the read projection's
`recommendedAction`. A recommendation is never consent. The assistant needs a
current `subscriptionActionQuote` whose target and timing match the proposed
choice, states the returned exact-price label, and then gets explicit
confirmation. When that quote is absent, the assistant does not guess and uses
the neutral Settings handoff.

The tool is available only in a private personal conversation with current
eligible accepted member input. Assistant policy permits a call only after the
member makes one exact choice in that turn. The runtime attaches the input id
itself; the model cannot provide one, and the first call consumes that turn's
ephemeral subscription capability. Web also claims the requested action on the
existing live conversation mailbox row with one atomic compare-and-set before
billing. An exact same-action retry is allowed; a conflicting action requires
new eligible member input. The durable claim survives process restart and is
removed with the mailbox row under existing retention. The backend does not
claim to prove the meaning of the message. Family and group contexts are
outside this surface.

For quote timing `now`, Web creates an ordinary checkout for the exact quoted
plan. For `immediate`, the existing plan-change admission service validates the
current member, billing owner, exact Customer and Subscription, one licensed
monthly Subscription Item, target Price, and absence of a schedule or pending
update before creating a Customer Portal `subscription_update_confirm` deep
link. For `at_period_end`, the existing switch service creates the narrow
Stripe-owned schedule. Stripe owns exact proration, payment collection,
payment-method recovery, required authentication, and the future phase. Its
successful redirect returns to Settings, where a bounded status surface waits
for the webhook-owned Postgres projection instead of claiming entitlement from
the redirect itself.

The hosted-execution wire decoder temporarily accepts the retired
`continue_pulse`, `start_pulse_now`, and `upgrade_edge` action names from already
deployed runtimes. They are not advertised to the model, do not restore trial
semantics, and delegate to the same quoted checkout/upgrade owners. Remove that
reader compatibility only after every preceding runtime is drained and cannot
be rolled back.

The retired Stripe hosted-AI meter is not part of current allowance accounting
or billing. A dry-run-first operator migration removes only explicitly marked
legacy metered items from otherwise recognized direct Murph subscriptions with
no proration or charge. It skips terminal subscriptions and fails closed before
apply when an active subscription has an unknown item, schedule, or pending
update. Immediate plan confirmation does not delete compatibility items in the
member's request path and does not retain Murph-owned invoice recovery as a
fallback.

The assistant may discuss plan and usage options before a choice, but the first
assistant-initiated commercial mention is one short, reply-oriented question
with no link. A starter exhaustion off-ramp may naturally ask “should we part ways?”; this is
optional language, not a fixed script or pressure tactic. If a trusted manual
check finds no action is needed and the member did not ask about billing, the
assistant says nothing unless trusted low-usage context calls for the generic,
link-free heads-up defined below. Existing automated recovery notices may keep
their current account links; they are not authority to invoke
`murph.subscription`.

When discussing a usage-saving model, call it “a less capable model that uses
less AI usage.” Do not assume the member knows Luna, Terra, or
Sol; name a model only if they ask. Never switch models automatically.

## Runtime Access And Notices

The web-owned allowance gate is the single model-work admission owner. It
combines current included capacity with the compact usage-credit
projection. When both reach zero, subsequent assistant or eligible system work
is denied with `ai_usage_limit_exceeded`; inactive, suspended, or malformed entitlement and existing abuse controls
remain separate fail-closed reasons. The read-only plan-usage projection presents that combined
capacity as one overall available-usage view; it remains a projection and must
not be treated as the gate result.

Usage accounting may create a period-scoped notice candidate when remaining
effective capacity reaches zero. Low capacity does not send a standalone
message. On the next allowed conversation-mailbox fetch, Web projects only a
coarse `low` bit when effective remaining capacity is at or below the shared
20% threshold. The runtime binds that trusted bit to the accepted input, and
Murph completes the current request, reads the package-owned
`hosted-low-usage` skill, and appends one short final segment to the resulting
reply. Bubble-capable messaging routes place that segment after `---`; other
hosted routes use a final paragraph and never expose the delimiter as copy.
That first heads-up prefers a known reset or trial-end date to percentage and
forecast detail, asks one reply-oriented question, and contains no link. It
does not split status, forecast, handoff, and disclaimer into separate usage
bubbles. The heads-up waits for a later eligible turn
during urgent, emergency, crisis, or materially sensitive replies and whenever
the current request requires a safety-changing or materially important
question. When the member already asks about usage, billing, continuation, or
adding usage, Murph answers that request directly under the normal tool rules
instead of appending a redundant heads-up. Every rendered
personal limit notice states the included allowance as 100% used before the
channel-specific follow-up copy.

Before claiming delivery, web re-authorizes a personal target against current
member routing or an external Linq target against persisted thread authority.
An omitted target means no accepted conversation and permits the legacy
personal-home fallback; explicit `null` means an accepted input had no single
safe route and forbids lookup, claim, and send; an object permits only that
exact target. Later counted usage may retry an uncompleted capacity-epoch
claim, while the delivery owner permits at most one completed notice per
period, plan-reset cutover, and usage-credit ledger version. A stale pre-reset
candidate fails its locked eligibility recheck; exhaustion after a plan reset
receives a fresh delivery identity.

### Operator usage recovery

`/ops/usage` is the supported operator surface for inspecting and resetting
hosted allowance state. It lists personal members and synthetic group
containers from the existing hosted-member owner in deterministic primary-key
cursor pages of 25, using a cap-plus-one read for next-page evidence. Operators
can move forward and backward through the ordinary page controls; there is no
cache, snapshot table, or duplicate read model. Per-entity message totals come
from retained canonical `conversation.message` mailbox rows filtered to the
current page member IDs, so the surface labels the 30-day retention boundary
instead of presenting those rows as lifetime history. The trailing seven-day
total and daily average use the same page-scoped mailbox source. Per-row
all-time priced AI usage is derived from immutable counted `HostedAiUsage` rows
for those same IDs. Whole-population member/container counts, seven-day active
entity count, and all-time counted usage sum remain scalar set-based aggregates;
they never materialize one aggregate result per lifetime member.

Search is URL-backed and replaces ordinary pagination for that render. A query
must be one complete hosted member/container ID, one exact verified email, or
exactly the final four phone digits. Member ID lookup remains in the
hosted-member owner. Exact email lookup derives the existing current-and-read
blind-index candidates and selects only verified authorization rows; it never
selects or decrypts the encrypted email column. Final-four lookup uses only the
persisted plaintext masked-phone hint. Each search reads one ID-ordered
cap-plus-one candidate set, hydrates at most 100 matches through the same usage
read, and shows no page controls. If the 101st match exists, the page says the
set is capped and requires the operator to narrow the query rather than claiming
the first 100 are complete. Whole-population summary totals stay unfiltered.

Token allowance pricing is provider-aware at ingestion time. OpenAI rows use
the OpenAI GPT-5.6 rate table, while rows with recorded provider `venice` use
Venice's documented regular GPT-5.6 input, cache-read, cache-write, and output
rates for the canonical Luna/Terra/Sol tier. The immutable pricing snapshot
records the provider source and matching provider model id. Historical rows
are not repriced when provider pricing changes.

A reset resolves exactly one current allowance state through the canonical
gate, so Family-sponsored, Starter, direct-billing, thread-container,
inactive-access, plan-change, and no-persisted-row behavior cannot drift from
runtime admission. For recurring included allowance, it targets the current
period and clears included spend and its blocked state. For a fully exhausted
direct Starter member with zero total credit, it appends one fresh policy-sized
recovery grant keyed to the locked pre-grant ledger version, then clears the
derived lifetime-period block. A later operator recovery is eligible only after
that credit is consumed and the current canonical gate is fully exhausted
again; this is discretionary support recovery, not an automatic or member-owned
refill promise.

`Reset everyone` is an explicit destructive recovery walk, not a bulk database
mutation. It always ignores the active search query, requires the operator to
type `RESET EVERYONE`, and explains that the population is not snapshotted and
ongoing usage is not paused. Each authenticated same-origin request reads at
most 11 hosted IDs in ascending order, admits 10, and processes those members
one at a time through the canonical single-member reset. A stale member is
re-read once before the request stops; notice-claim contention and any remaining
failure stop the batch before the failed member is acknowledged. No interactive
transactions overlap, and runtime recheck happens only after that member's reset
transaction commits.

The response reports processed, reset, unchanged, skipped, pending-wake, and
failed outcomes plus the last acknowledged member ID. While the page remains
open, the client may issue the next bounded request. It pauses on a known or
ambiguous failure and can resume strictly after the last acknowledged cursor.
Hiding a paused dialog preserves the same in-memory operation UUID, cursor,
counts, and failure while keeping conflicting row and search mutations locked.
The operator must pass a separate warning to abandon that operation; starting
again after abandonment creates a new UUID and may process previously committed
members from their then-current state.
When a population response is unknown, recovery may rewalk from the beginning
with the same browser-created operation UUID. After the population is fully
acknowledged, runtime-wake recovery has a narrower owner: it pages only that
UUID's existing wake-required receipts in member-ID order and invokes only the
bounded post-commit runtime recheck. It never reads the current member
population or enters a reset transaction, so members created after the original
typed confirmation cannot be admitted to that operation. The dialog does not
claim completion until a full receipt-owned wake pass reports no pending wake.
Terminal non-retryable inactive-runtime results count as no longer applicable;
retryable runtime and transport failures remain pending.
The walk owns no campaign row, queue, scheduler, or second usage projection.

Every reset-everyone member outcome has one append-only receipt keyed by the
operation UUID and member ID. The first serializable member transaction inserts
the receipt atomically with any included-usage reset, Starter grant, or stable
unchanged/skipped decision. A replay therefore cannot clear included usage
accrued after an earlier committed reset, and it cannot append another Starter
grant after the first was fully consumed. Starter grants also retain the UUID
in their immutable semantic source key for append-time uniqueness only; the
receipt is the sole replay authority. A concurrent same-operation request
that loses the receipt race receives one bounded serialization retry. Receipts
contain no decrypted contact value and are deleted with their member.

That transaction is also the sole outcome authority: after the member lock and
receipt check it reads the live gate and the exact current-period row. An
allowed paid, Family-sponsored, or group-container member whose zero-usage
period has not been materialized records a stable skipped receipt without
creating a usage row, so the population walk acknowledges that member and
continues. If canonical accounting commits the period first, the same locked
owner observes and resets it; if the skip commits first, later accounting is
new usage and same-operation replay preserves it.

The server locks the member and period in the same order as usage accounting
and verifies the period timestamp and usage-credit ledger version shown to the
operator. In the same serializable transaction it releases only the matching
period-and-credit-version notice claim by clearing that delivery row's unique
lookup key. The delivery row remains as history. A recent pre-provider dispatch
makes the operation retryable instead of permitting a concurrent duplicate
send.

For each displayed row, the table reads the canonical gate decision and exact
persisted-period concurrency timestamp inside one short repeatable-read
transaction. Those transactions run sequentially and are bounded by the
ordinary 25-row page or the 100-row search cap; no transaction spans multiple
members or the whole dashboard render.
Its blocked/available label comes from the canonical gate decision, never from
the persisted `blocked_at` marker, because a plan change can make that storage
marker stale until the mutating gate reconciles it. A historical notice claim
is shown independently and never suppresses canonical availability. After reset
commit, the route signals the existing hosted runtime recheck so accepted
mailbox work is reconsidered immediately. That signal uses the existing bounded
handoff deadline and forwards its abort signal. A rejection or timeout reports
the reset as committed and exposes a wake-only retry instead of replaying the
reset or claiming complete recovery. For Starter recovery, that affordance is
reconstructed after close or reload from the active Ops recovery grant plus
unconsumed mailbox work previously denied for AI usage; it is not owned only by
component state. Reusing the logical notice key still
permits only one active claim, while each explicitly re-released notice gets a
fresh durable attempt ID and Linq provider idempotency key. Generic runtime and
webhook delivery fences retain their deterministic durable IDs. This prevents a
retained history row or provider deduplication from suppressing the next real
limit crossing without changing unrelated delivery correlation.

Reset never deletes or rewrites immutable usage rows, usage-credit entries,
billing state, mailbox rows, or delivery history. The Starter branch is the
only credit mutation: it appends one immutable recovery grant and advances the
existing balance/version projection under the beneficiary lock. It never
replenishes an old grant or changes purchased/referral credit. Reset creates no
second usage ledger or message counter. A stale table row fails closed and must
be refreshed before retrying.

Every proactive billing action in Settings, Home, or `murph.plan_usage` comes
only from the projection's thresholded `recommendedAction`. A notice code, plan
label, incomplete billing row, or legacy state must not independently imply
**Start Pulse**, **Upgrade to Edge**, or **Add usage**. A requested
`subscriptionActionQuote` may disclose current terms below that threshold, but
it must not be presented as a recommendation. The explicit Settings handoff
above remains navigation rather than an action and must not be presented as a
plan recommendation.

## Assistant Policy

`murph.plan_usage` accepts no arguments. Member identity comes from the signed
runtime callback, not from the model. Murph may call it only when a member asks
about their current plan or AI usage, explicitly asks to manage billing
or an unsupported Family account change, or when a trusted runtime instruction
requests one manual private check. A trusted check authorizes the read only; it
does not authorize a billing action or a proactive payment link.

Do not turn this read into onboarding automation, a recurring threshold
watcher, or a group-chat billing report. Do not name a group payer, invent a
balance, use guilt, or manufacture urgency or scarcity beyond the current
coarse capacity state.

The low-usage skill may use the trusted bit for one manual private
`murph.plan_usage` check. It follows the current Web-owned state rather than
inventing a billing menu:

- a direct Starter member may offer help starting the current eligible paid
  plan only from the current thresholded recommendation, with the existing
  quote and confirmation rules;
- a direct paid Pulse or Edge plan may offer the authorized one-time Add usage
  handoff, while Edge is discussed as a recurring Pulse alternative only after
  the member asks and a current quote exists;
- a Family-sponsored member is never offered a personal top-up; a Family Pulse
  or Edge seat may be moved to a higher Family tier by the plan owner, but the
  assistant verifies
  `owner: true` through the Family status read before offering that owner a
  private Settings handoff; a sponsored non-owner is told that the Family
  owner must make the change, while Family Max has no higher current tier; and
- a hosted group gets a proactive first heads-up: on the first trusted
  low-usage turn the assistant calls `murph.group action="read_usage"` once.
  `fundingNeeded` is the only assistant-facing urgency signal. It is false when
  capacity is healthy and while a low room has an automatic refill available
  or already pending, including a current-period payment already bound before
  an authorization pause; it is true when a low room has no automatic recovery
  and whenever the room is exhausted. When false, the heads-up is suppressed
  without the assistant inferring or explaining why. When true, the segment
  stays conversational, link-free, and option-neutral: it
  calls the shared capacity "Murph time," says Murph may pause for the room,
  and asks whether they want Murph to check the options without naming or
  counting any path. The assistant receives no current sponsorship-status
  field. Payer identity, payment setup, cap, charges, credit balance or source,
  remaining capacity, period dates, message counts, and refill events stay
  private. The required current-response `includedUsageUsedPercent` is separate from urgency and
  may be stated only when a participant explicitly asks how much AI usage the
  room has consumed or asks for the room's current usage status. It never
  appears in this proactive heads-up or in a general funding-options answer.
  Murph never frames each text as a unit being purchased or spent. After
  someone asks for the options, asks for more Murph time, asks how to keep the
  room going, or accepts the quick path, the assistant reads the options for
  that responding sender, using the exact accepted request-bearing message as
  participant authority rather than inferring one sender from the whole grouped
  turn. It refreshes current usage as needed, presents every returned earned
  and group-funding path, and may include a returned first-party funding URL
  after the funding path instead of leading with it. `fundingNeeded` controls
  whether the assistant says the room currently needs more Murph time, not
  whether an explicitly requested funding capability exists.
  Playful payer nomination is allowed, but who actually paid, purchase status,
  and amounts stay private, and the assistant never promises a URL the read did
  not return. For a group without an owner-created join code, the funding URL
  carries a signed funding-only locator that grants no enrollment or sharing,
  so the URL is normally present without any write.

For an explicit Family member-usage management request, the assistant first
calls `murph.family_plan action="read_status"`. It may provide
a private Family Settings handoff only when that current result has
`owner: true`, `billingActive: true`, and the intended person matches exactly
one active member row. For the active owner's own row, it may provide the stable
`/settings?addUsage=family#family` link; Settings resolves the target from the
authenticated current Family and receives no model-composed identifiers. For
another active member, it provides `/settings#family` so the owner selects that
member inside Settings. The handoff is browser navigation only: the assistant
does not choose an amount, create Checkout, or claim payment or usage
completion. It asks one narrow clarification for a missing or ambiguous member
and provides no handoff when any authority gate fails. `murph.plan_usage` and
the personal subscription handoff are not substitutes for this Family gate.

## Group Usage

Classify a group-thread allowance from its source, never by comparing its
numeric cap with a trial cap. `murph.plan_usage` still returns
`group_not_supported`; group capacity is not projected as a personal plan or a
synthetic personal allowance. The existing `murph.group` tool's `read_usage`
action reports `fundingNeeded`, the current first-party funding URL, and an
integer `includedUsageUsedPercent` on every successful current response.

Web owns the aggregate. The successful thread-container usage gate already
proves that the included limit is positive; an inactive or malformed limit
makes the read unavailable. With current-period counted included spend `spent`
and included limit `limit`, Web returns `0` when `spent <= 0`, `100` when
`spent >= limit`, and `max(1, floor(spent * 100 / limit))` in between. This is
the percentage of the room's included usage for the current period that has
been used. It excludes purchased, referral, carryover, and automatic-refill
credit. Credit changes therefore cannot lower or reset it; a new included
period can. A value of `100` means at least all included usage has been used,
not that effective capacity is exhausted, because credit may remain.

The assistant may disclose the aggregate only after a participant explicitly
asks how much AI usage the room has consumed or asks for the room's current
usage status. It says, in substance, "About X% of this room's included usage
for the current period has been used." For `100`, it says at least all included
usage has been used and does not say the room is exhausted unless an
authoritative capacity result separately says so. The transport returns the
field on every successful current response and does not infer intent. A
funding-only current response is schema-invalid by design; during accepted
mixed-version skew Murph says the quantitative status is unavailable instead
of estimating it from funding urgency, sponsorship, messages, or history.
Filesystem-capable group-chat turns load the detailed hosted-low-usage skill.
Because group-email turns deliberately have no filesystem or shell access, the
stable group-email prompt carries the same compact one-read, bounded-answer,
100-is-not-exhaustion, and unavailable-result contract. That room-public read
does not authenticate the email sender or authorize a mutation.

Web derives `fundingNeeded` from current capacity plus automatic-refill
availability. It keeps the underlying healthy/low/exhausted state, raw spend
and limit, remaining capacity, funding setup, internal USD-micro accounting,
credit amount or source, contributors, receipts, payer identity, sponsor cap,
charges, pending payments, refill state and events, period dates, and message
counts out of the assistant projection.
The recovery projection does not read the page-only sponsorship projection,
so a private sponsor-state failure cannot remove the exhausted-room action.

Group low usage follows the same next-turn context path as personal usage: it
never creates a standalone message, and the prompt asks Murph to finish the
current request before mentioning the low capacity casually as "Murph time"
and without a link. After someone asks for options, asks for more Murph time,
or asks how to keep the room going, a current read may supply the funding link
as part of the group-funding path; the assistant does not lead with it. Message
counts stay out of unsolicited and general-options copy; Murph gives the exact
server-returned approximate count only when someone asks how much a path adds
or a post-action confirmation requires it. A deterministic group exhaustion
notice may use only the exact originating external-thread target after Web
re-authorizes its persisted thread authority; no personal-home fallback is
valid for an accepted group conversation. At delivery time Web rechecks the
exhausted state in the existing notice claim and sends the group's funding link
with one neutral group pause contract. The mandatory action URL uses a signed
funding-only locator derived from the runtime member, so private sponsor state,
group display data, join-code preference, and access lookups cannot remove it
before the claim. The funding page keeps an authenticated signed locator in its
funding path, client endpoints, and purchase return URL; it never exchanges the
funding-only capability for an owner-created enrollment code. After target
authorization, group purchases identify the exact destination by the resolved
beneficiary runtime member rather than by the route locator, so either valid
funding entry point resumes the same purchase without exposing join authority.
This notice has one behavior regardless of current
funding setup: it says Murph is paused, identifies the link as private options
to add more time, and says the room may instead wait for reset. It does not use
rotating payer-pressure copy or promise immediate restoration. The funding page
separately preserves any active automatic
sponsor and the single-sponsor billing invariant. The notice does not expose
payment setup, name a payer, amount, cap, balance, or refill, claim that payment
occurred, or add a separate scheduler or money-prompt lifecycle. If the
mandatory locator, first-party origin, or signing configuration is unavailable,
delivery fails before the capacity-epoch claim/provider path instead of sending
linkless fallback copy. The existing production predeploy guard must construct
and parse this same signed URL from the configured HTTPS hosted origin and
signing authority before serving traffic. Runtime validates against that same
configured origin. A completed crossing has no separate replay owner, so this
pre-serve invariant—not the denied-gate path—guarantees configuration cannot
strand the one-shot notice.

## Non-Goals

The subscription-action surface adds one nullable action claim to the existing
mailbox row. The composed usage system adds no second admission gate, persisted
forecast, billing queue, cron, trial-ending webhook, automatic nudge, group
wallet or usage account, automatic model switch, custom card form, App Clip,
or mini app. It does not add a general Stripe API tool: the contract exposes
only transitions admitted by the current web-owned plan policy. Personal and
Family-member usage top-ups remain authenticated Stripe-hosted Settings
handoffs. Group funding uses the existing join code and synthetic member
through an authenticated fixed-pack page; anonymous funding remains
unimplemented.

## Deployment

The non-expiring Starter contract was a strict Web/runtime schema hard cut. The
production rollout is complete: compatible Web and Cloudflare code from the
same current public `main` deployed without intentionally pausing Render or
hosted execution, managed-container and live-model smoke proved the runner, and
the post-deploy contract-migration workflow applied the migration after its
declared drain.

Do not remove `HOSTED_EXECUTION_CONTROL_URL` for a future plan-usage rollout.
It is shared by runtime starts, privacy actions, export, media, and account
deletion, so removing it would disable unrelated operations rather than provide
a route-scoped pause. The current rollback floor is forward-only: repair or
redeploy a compatible current Web/runner pair; the prior Web or runner is not a
resumable target against the migrated ledger.

The one-time legacy Stripe object drain is complete. The bounded delayed-event
compatibility contract and its final removal gate live in
`agent-docs/product-specs/starter-usage.md`.

For the capacity-epoch change, deploy the assistant runtime that timestamps
every provider operation at its own request start, then wait for work accepted
by the previous runtime to drain. Apply the additive usage-period and
billing-transition columns and promote the Web reconciliation owner only after
that drain. Existing Web code ignores the new columns. Migration-owned
transition bridges snapshot the exact Stripe event time for direct billing and
the local membership cutover for Family changes made by a draining Web
instance. New Web adopts such an already-applied reset without erasing usage
accrued afterward. It otherwise fails closed if a row lacks historical plan
classification or an exact transition marker: spend is preserved and no
duplicate reset is granted. Audit current-period rows immediately after
promotion for missing transition or high-water metadata. Roll back Web before
the runtime; the nullable columns and bridges may remain.

For the subscription-action quote contract, apply the additive mailbox-claim
migration, then deploy Web, then deploy the Cloudflare runtime. An old runtime
continues to send the empty plan-usage request, and new Web omits
`subscriptionActionQuote`, preserving the old strict response shape. The new
runtime opts into the quote field only after Web can parse that request and
serve the durable action claim. A new runtime against old Web is unsupported
because old Web rejects the opt-in request and does not provide the durable
claim. Roll back Cloudflare before Web; the nullable column may remain. This
order also preserves the originating-notice-target compatibility contract
described in `hosted-plan-downgrades.md`.

For a new personal billing-plan code added to the strict plan-usage and
subscription response schemas, deploy Cloudflare hosted execution and roll the
runner bundle out immediately before deploying Web. The new runtime remains
compatible with old Web responses, while an old runtime rejects a Web response
that names the new plan code. Verify the serving runner fingerprint and a
controlled plan-usage read before promoting Web. Configure the new Stripe price
and Portal transition before the Web deploy exposes the plan, then verify its
Settings card and conversational quote/confirmation boundary. Roll back Web
before rolling back Cloudflare so Web stops producing the new code before an
old strict consumer returns to service.

Ship the `includedUsageUsedPercent` Web producer, strict runtime reader, and
assistant policy as one product change. There is no strip-only reader phase or
rollout-only feature flag. A mixed-version Web/runner window may temporarily
make the strict group usage read fail; that availability tradeoff is accepted.
After Web and Cloudflare converge, prove the serving runner fingerprint and run
one controlled explicit group usage-status question. Roll back both sides to a
schema-compatible pair if rollback is required.

Existing billing mechanics remain in:

- `agent-docs/product-specs/starter-usage.md`
- `agent-docs/product-specs/hosted-plan-downgrades.md`
- `agent-docs/product-specs/hosted-family-plan.md`

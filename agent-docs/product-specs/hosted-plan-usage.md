# Hosted Plan Usage And Subscription Actions

Last verified: 2026-07-16
Status: Implemented current-state contract

## Goal

Give a member one honest view of their current included AI usage, block new
usage-bearing work when included and purchased capacity are both exhausted,
and let a private Murph conversation carry out the smallest billing action the
member clearly chooses. Settings and Murph's read-only plan-usage tool consume
the same web-owned projection. Stripe and the existing web billing services
remain the payment system; Murph owns allowance and purchased usage capacity.
The personal top-up implementation contract lives in
`agent-docs/product-specs/hosted-usage-topups.md`.

## Ownership

`apps/web` derives the projection from the existing allowance resolver and
hosted usage ledger. It also selects any billing action shown to the member.
The projection is a read: it does not write a forecast, query Stripe, create a
usage period, or change billing state.

Purchased credit stays separate from the included-allowance period. The
append-only credit ledger is canonical, and the compact member balance/version
is its bounded admission and Settings projection. The plan-usage response may
recommend the authenticated Settings top-up handoff, but it cannot create
Checkout or grant credit.

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
| Direct trial | Pulse Trial | Trial | Start Pulse |
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
Inactive hosted access and a trial awaiting conversion also return explicit
unavailable states.

Usage is cost-weighted included capacity across models and modalities. It is
not a token count or cash balance. Used and remaining included percentages are
bounded integers that sum to 100. An included period reports 100% used even
while purchased credit still keeps effective capacity positive. Settings shows
that carryover credit separately as usage credit; it never folds it into the
plan percentage or exposes the internal included allowance value. The
operation that crosses effective capacity may finish, but subsequent
usage-bearing work blocks and accepted conversation input remains pending.

A forecast requires at least 24 hours of counted usage. It is shown only when
the observed pace projects exhaustion before the current period ends. The
forecast is conservative and optional; the product must not invent one when
the projection omits it.

## Actions

`apps/web` may return `recommendedAction` only when included usage is
exhausted, the forecast projects exhaustion, or at least 80% of included usage
is used. Trial access may recommend **Start Pulse now** with the
current monthly price. An eligible direct paid Pulse or Edge member may receive
**Add usage**, which opens the authenticated fixed-pack Settings dialog. Pulse's
Edge upgrade remains on the plan card. Family and group contexts do not receive
a top-up recommendation.

An opted-in `subscriptionActionQuote` answers a different question: what are
the current terms for the exact start-now or upgrade choice the member asked
about? Web resolves that quote even below the usage threshold and without a
Settings URL. The quote contains the bounded action and current catalog label,
not a URL. It may be null when the action is ineligible. It is neither a
recommendation nor consent, and it does not weaken the explicit-confirmation
rule.

Home and `murph.plan_usage` render only `recommendedAction`. Settings may expose
**Add usage** at any utilization for an eligible direct paid member, using the
same server-projected offers. Subscription actions still use the existing
server-authorized billing route; **Add usage** uses the authenticated one-time
Checkout route described in the top-up spec. Assistant policy uses a matching
`subscriptionActionQuote` only to disclose current terms before seeking an
explicit choice. The read-only `murph.plan_usage` tool cannot start checkout,
upgrade a plan, grant credit, or claim that a billing change happened.

An explicit request in a private conversation to manage billing, or to perform
a Family account change outside `murph.family_plan`'s status, checkout, and
invite actions, may receive the canonical `/settings#subscription` handoff
after `murph.plan_usage` returns `active`, `exhausted`, or
`trial_conversion_pending`. This is neutral browser navigation, not a projected
billing action or recommendation. The assistant must say that no billing or
Family change happened. It must not provide the private management handoff for
`group_not_supported` or `hosted_access_inactive`, or offer it proactively.

### Private Conversation Actions

`murph.subscription` is a narrow mutation surface for three choices:

- keep an active Pulse trial scheduled to continue at its natural end;
- end the trial and start Pulse now; or
- upgrade an active paid Pulse plan to Edge.

These are member-directed actions, not extensions of the read projection's
`recommendedAction`. A recommendation is never consent. Before an immediate
start or upgrade, the assistant needs a `subscriptionActionQuote` whose action
matches the proposed choice, states the returned label, and then gets explicit
confirmation. When that quote is absent, the assistant does not guess and uses
the neutral Settings handoff. Continuing a currently active trial does not
charge now and does not require a start-now quote or recommendation.

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

Continuing an active trial with a configured default payment method is already
represented by the existing Stripe subscription. Nothing is needed right now:
the choice requires no charge, subscription update, payment link, or
unsolicited explanation. A configured method does not guarantee that a future
renewal will succeed. If the payment method is missing, web may return a Stripe
Customer Portal payment-method-update URL. A paused-trial state race remains
recoverable through the existing Pulse activation service rather than gaining a
second resume path. Assistant policy treats an already ended or
conversion-pending trial as a start-now choice, discloses the current terms,
and asks for explicit confirmation instead of presenting it as non-charging
continuation.

After a signed-in member completes a payment-method-update link returned by
private-chat `continue_pulse` or `start_pulse_now`, the authenticated browser
return automatically resumes that exact claimed action. The short-lived signed
return contains no member identifier, and the resulting HttpOnly claim is bound
to the current member, app session, and action. Cancel, copied-to-another-member,
expired, tampered, and marker-only returns remain inert. The browser never
upgrades a continue-at-trial-end choice into an immediate start.

Starting Pulse now uses the existing start-paid-Pulse service. Upgrading to
Edge uses the existing plan-change service. Pulse activation keeps its existing
Stripe-hosted invoice or Customer Portal handoff when payment is required. A
pending Edge change returns the existing Customer Portal handoff and does not
retrieve or validate a separate invoice URL. The assistant sends a returned
Stripe URL only after the member's explicit choice and only when the
authoritative result says payment is required. Completed, pending, and
no-action results do not carry a URL.

The assistant may discuss plan and usage options before a choice, but the first
assistant-initiated commercial mention is one short, reply-oriented question
with no link. A trial off-ramp may naturally ask “should we part ways?”; this is
optional language, not a fixed script or pressure tactic. If a trusted manual
check finds no action is needed and the member did not ask about billing, the
assistant says nothing. Existing automated recovery notices may keep their
current account links; they are not authority to invoke `murph.subscription`.

When discussing a usage-saving model, call it “a less capable model that uses
less of your included usage.” Do not assume the member knows Luna, Terra, or
Sol; name a model only if they ask. Never switch models automatically.

## Runtime Access And Notices

The web-owned allowance gate is the single model-work admission owner. It
combines current included capacity with the compact purchased-credit
projection. When both reach zero, subsequent assistant or eligible system work
is denied with `ai_usage_limit_exceeded`; inactive, suspended, malformed or
expired trial entitlement, and existing abuse controls remain separate
fail-closed reasons. The read-only plan-usage projection remains an
included-period view and must not be treated as the gate result.

Usage accounting may create a period-scoped notice candidate when the
operation consumes the last effective capacity. A message-triggered record
carries its originating Linq or Telegram target through the current invocation
and signed usage-record seam. Every rendered limit notice states the included
allowance as 100% used before the channel-specific follow-up copy.
Before claiming delivery, web re-authorizes a personal target against current
member routing or an external Linq target against persisted thread authority.
An omitted target means no accepted conversation and permits the legacy
personal-home fallback; explicit `null` means an accepted input had no single
safe route and forbids lookup, claim, and send; an object permits only that
exact target. Later counted usage may retry an uncompleted period claim, while
the delivery owner permits at most one completed notice.

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
about their current plan or included usage, explicitly asks to manage billing
or an unsupported Family account change, or when a trusted runtime instruction
requests one manual private check. A trusted check authorizes the read only; it
does not authorize a billing action or a proactive payment link.

Do not turn this read into onboarding automation, a recurring threshold
watcher, or a group-chat money prompt. Do not name a group payer, invent a
balance, or use guilt, urgency, or scarcity language.

## Group Usage

Classify a group-thread allowance from its source, never by comparing its
numeric cap with a trial cap. `murph.plan_usage` returns
`group_not_supported`, and any group-thread usage notice stays neutral: no
account link, personal plan, model choice, upgrade, top-up, or payer identity.
The notice may use only the exact originating external-thread target
after web re-authorizes its persisted thread authority; no personal-home
fallback is valid for an accepted group conversation.

## Non-Goals

The subscription-action surface adds one nullable action claim to the existing
mailbox row. The composed usage system adds no second admission gate, persisted
forecast, billing queue, cron, trial-ending webhook, automatic nudge, group
balance, automatic model switch, custom card form, App Clip, or mini app. It
does not add a general Stripe API tool: the subscription action contract
exposes only the three current web-owned operations above, and personal usage
top-ups remain an authenticated Stripe-hosted Settings handoff. Group and
Family funding remain unimplemented.

## Deployment

Apply the additive mailbox-claim migration, then deploy Web, then deploy the
Cloudflare runtime. An old runtime continues to send the empty plan-usage
request, and new Web omits `subscriptionActionQuote`, preserving the old strict
response shape. The new runtime opts into the quote field only after Web can
parse that request and serve the durable action claim. A new runtime against
old Web is unsupported because old Web rejects the opt-in request and does not
provide the durable claim. Roll back Cloudflare before Web; the nullable column
may remain. This order also preserves the originating-notice-target
compatibility contract described in `hosted-plan-downgrades.md`.

Existing billing mechanics remain in:

- `agent-docs/product-specs/pulse-trial-start-paid-pulse.md`
- `agent-docs/product-specs/hosted-plan-downgrades.md`
- `agent-docs/product-specs/hosted-family-plan.md`

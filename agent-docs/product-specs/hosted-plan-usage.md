# Hosted Plan Usage And Subscription Actions

Last verified: 2026-07-15

## Goal

Give a member one honest view of their current included AI usage, then let a
private Murph conversation carry out the smallest billing action the member
clearly chooses. Settings and Murph's read-only plan-usage tool consume the same
web-owned projection. Stripe and the existing web billing services remain the
only billing system.

## Ownership

`apps/web` derives the projection from the existing allowance resolver and
hosted usage ledger. It also selects any billing action shown to the member.
The projection is a read: it does not write a forecast, query Stripe, create a
usage period, or change billing state.

`@murphai/hosted-execution/plan-usage` owns the strict transport contract.
Cloudflare carries that contract over the existing signed `web-control.worker`
boundary through `planUsageToolPort`. Assistant runtime passes the semantic
port into assistant-engine, which advertises `murph.plan_usage` only when the
port exists. Billing truth and mutation authority stay in `apps/web`.

`@murphai/hosted-execution/subscription` owns the separate strict action
contract. Cloudflare carries it through `subscriptionToolPort` over the same
signed callback boundary. Assistant policy requires an explicit, unambiguous
current-turn choice before invocation. The runtime attaches the current
eligible accepted private input id, and the model selects only a bounded
action. Web binds that action to the callback member and live input before it
revalidates the current plan and action eligibility. This binding proves
current authority and provenance; it does not semantically interpret the
member's text. The runtime never receives Stripe credentials or derives
billing state.

## Status Semantics

The available projection keeps these access states distinct:

| Access | Display plan | Period | Possible action |
| --- | --- | --- | --- |
| Direct trial | Pulse Trial | Trial | Start Pulse |
| Direct paid Pulse | Pulse | Monthly | Upgrade to Edge |
| Direct paid Edge | Edge | Monthly | None |
| Sponsored member | Family | Monthly | None |

An active sponsored member keeps their assigned Family tier when the local
Family billing projection is absent, invalid, or lacks a period containing the
usage timestamp. Only a valid paid Family projection supplies period bounds;
otherwise the shared allowance resolver uses its existing UTC calendar-month
fallback, just as it does for direct paid plans. Because included usage is
advisory rather than an exact prepaid meter, already-accounted fallback usage
is not moved between periods later.

Synthetic group-thread allowance is not personal plan usage. It returns the
unavailable reason `group_not_supported` before exposing personal usage facts.
Inactive hosted access and a trial awaiting conversion also return explicit
unavailable states.

Usage is cost-weighted included capacity across models and modalities. It is
not a token count, cash balance, or exact prepaid meter. Used and remaining
percentages are bounded integers that sum to 100. An exhausted period reports
100% used. Member-facing usage progress in Settings, Home, assistant replies,
and outbound limit notices uses these percentages; internal currency-denominated
accounting must not appear as a used-versus-allowance display.

A forecast requires at least 24 hours of counted usage. It is shown only when
the observed pace projects exhaustion before the current period ends. The
forecast is conservative and optional; the product must not invent one when
the projection omits it.

## Actions

`apps/web` may return an action only when the period is exhausted, the forecast
projects exhaustion, or at least 80% is used. Trial access may return **Start
Pulse now** with the current monthly price. Paid Pulse may return **Upgrade to
Edge** with the current monthly price. Both labels are derived from the web
billing-plan catalog. Edge and Family do not get an action from this surface.

Clients render only the returned action descriptor and still use the existing
server-authorized billing route. The read-only `murph.plan_usage` tool cannot
start checkout, upgrade a plan, or claim that a billing change happened.

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
`recommendedAction`. A recommendation is never consent. Its server-derived
label is the current conversational quote before an immediate start or upgrade;
when that quote is absent, the assistant does not guess and uses the neutral
Settings handoff. Continuing a currently active trial does not charge now and
does not require a start-now recommendation.

The tool is available only in a private personal conversation with current
eligible accepted member input. Assistant policy permits a call only after the
member makes one exact choice in that turn. The runtime attaches the input id
itself; the model cannot provide one, and the first call consumes that turn's
ephemeral subscription capability. Another attempt requires new eligible
member input. Web binds the id and requested action to the callback member and
a live conversation message before it reads current eligibility or mutates
billing. The backend does not claim to prove the meaning of the message. Family
and group contexts are outside this surface.

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

Starting Pulse now uses the existing start-paid-Pulse service. Upgrading to
Edge uses the existing plan-change service. When either operation needs member
payment, web prefers Stripe's hosted invoice URL and may fall back to the
existing Stripe Customer Portal. The assistant sends a returned Stripe URL
only after the member's explicit choice and only when the authoritative result
says payment is required. Completed, pending, and no-action results do not
carry a URL.

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

Included usage is advisory. Reaching 100% does not deny otherwise-authorized
assistant or system work, and the plan-usage projection is never model-work
admission. Admission reads only the hosted member-access owner, where inactive,
suspended, malformed or expired trial entitlement, and existing abuse controls
still fail closed.

Usage accounting may create a period-scoped notice candidate after the included
amount is reached. A message-triggered record carries its originating Linq or
Telegram target through the current invocation and signed usage-record seam.
Every rendered limit notice states the exhausted allowance as 100% used before
the channel-specific follow-up copy.
Before claiming delivery, web re-authorizes a personal target against current
member routing or an external Linq target against persisted thread authority.
An omitted target means no accepted conversation and permits the legacy
personal-home fallback; explicit `null` means an accepted input had no single
safe route and forbids lookup, claim, and send; an object permits only that
exact target. Later counted usage may retry an uncompleted period claim, while
the delivery owner permits at most one completed notice.

Every billing action in Settings, Home, or `murph.plan_usage` comes only from
the projection's `recommendedAction`. A notice code, plan label, incomplete
billing row, or legacy state must not independently imply **Start Pulse** or
**Upgrade to Edge**. When the projection returns no action, the surface remains
informational. The explicit Settings handoff above remains navigation rather
than an action and must not be presented as a plan recommendation.

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
The advisory notice may use only the exact originating external-thread target
after web re-authorizes its persisted thread authority; no personal-home
fallback is valid for an accepted group conversation.

## Non-Goals

This feature adds no schema, second usage ledger, persisted forecast, queue,
cron, trial-ending webhook, automatic nudge, group balance, top-up flow,
automatic model switch, custom checkout page, App Clip, or mini app. It does
not add a general Stripe API tool: the action contract exposes only the three
current web-owned billing operations above, and every payment handoff is
Stripe-hosted.

## Deployment

Deploy web before Cloudflare/runtime. Old runtimes simply omit the tools while
Settings can use the web projection and existing billing services. A new
runtime deployed against old web would advertise callbacks that the old web
does not serve. This order also preserves the newer originating-notice-target
compatibility contract described in `hosted-plan-downgrades.md`.

Existing billing mechanics remain in:

- `agent-docs/product-specs/pulse-trial-start-paid-pulse.md`
- `agent-docs/product-specs/hosted-plan-downgrades.md`
- `agent-docs/product-specs/hosted-family-plan.md`

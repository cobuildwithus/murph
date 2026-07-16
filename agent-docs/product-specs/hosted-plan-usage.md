# Hosted Plan Usage Visibility

Last verified: 2026-07-16
Status: Checked-out source snapshot with a known product-contract discrepancy

## Goal

Give a member one honest view of their current included AI usage without
creating another billing system. Settings and Murph's read-only plan-usage tool
must consume the same web-owned projection. This document records the current
checked-out projection implementation; it is not product authority for whether
exhaustion blocks. The confirmed enforced contract and required source
reconciliation live in `agent-docs/product-specs/hosted-usage-topups.md`.

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
Pulse**. Paid Pulse may return **Upgrade to Edge**. Edge and Family do not get
an action from this surface.

Clients render only the returned action descriptor and still use the existing
server-authorized billing route. The tool cannot start checkout, upgrade a
plan, or claim that a billing change happened.

An explicit request in a private conversation to manage billing, or to perform
a Family account change outside `murph.family_plan`'s status, checkout, and
invite actions, may receive the canonical `/settings#subscription` handoff
after `murph.plan_usage` returns `active`, `exhausted`, or
`trial_conversion_pending`. This is neutral browser navigation, not a projected
billing action or recommendation. The assistant must say that no billing or
Family change happened. It must not provide the private management handoff for
`group_not_supported` or `hosted_access_inactive`, or offer it proactively.

## Runtime Access And Notices

The following advisory behavior describes the checked-out source and tests,
not the confirmed product contract. That contract blocks subsequent
usage-bearing work at exhaustion. The discrepancy must be reconciled at the
single admission owner before top-ups ship; adding a second gate is not a valid
correction.

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
requests one manual private check.

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

This feature adds no schema, second usage ledger, Stripe read, persisted
forecast, queue, cron, automatic nudge, group balance, top-up flow, or billing
mutation tool.

The separately proposed target-state extension lives in
`agent-docs/product-specs/hosted-usage-topups.md`. That specification treats
usage-limit blocking as the confirmed product behavior and supersedes this
snapshot's advisory statements as product policy. It also records the
checked-out source discrepancy that must be reconciled before implementation.

## Deployment

Deploy web before Cloudflare/runtime. Old runtimes simply omit the tool while
Settings can use the new web projection. A new runtime deployed against old
web would advertise a callback that the old web does not serve. This order also
preserves the newer originating-notice-target compatibility contract described
in `hosted-plan-downgrades.md`.

Existing billing mechanics remain in:

- `agent-docs/product-specs/pulse-trial-start-paid-pulse.md`
- `agent-docs/product-specs/hosted-plan-downgrades.md`
- `agent-docs/product-specs/hosted-family-plan.md`

# Hosted Plan Usage Visibility

Last verified: 2026-07-12

## Goal

Give a member one honest view of their current included AI usage without
creating another billing system. Settings and Murph's read-only plan-usage tool
must consume the same web-owned projection.

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

Synthetic group-thread allowance is not personal plan usage. It returns the
unavailable reason `group_not_supported` before exposing personal usage facts.
Inactive hosted access and a trial awaiting conversion also return explicit
unavailable states.

Usage is cost-weighted included capacity across models and modalities. It is
not a token count, cash balance, or exact prepaid meter. Used and remaining
percentages are bounded integers that sum to 100. An exhausted period reports
100% used.

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

## Denied Current Replies

The web reconciliation gate still stops denied work before assistant/model
execution. For a current personal inbound, web projects the already-resolved
gate decision through this same status owner and formats a deterministic reply;
it does not re-read allowance state or start an assistant turn. Linq/iMessage,
Telegram, WhatsApp, and email all receive that projection through their
existing channel delivery adapters.

The event-scoped delivery record separates prepared ownership from evidence
that a non-idempotent provider request may have started. Stale prepared work
can be reclaimed; post-start response loss remains confirmation-pending rather
than being mislabeled as notified or blindly resent. Linq can safely reclaim a
stale prepared attempt with the same provider idempotency key. Email and
WhatsApp retry only definite pre-provider failures or provider-owner-declared
retryable rejections.

Every billing action in the deterministic reply or Home banner comes only from
`recommendedAction`. A notice code, plan label, incomplete billing row, or
legacy state must not independently imply **Start Pulse** or **Upgrade to
Edge**. When the projection returns no action, the reply and banner remain
informational.

Denied current replies are idempotent per member plus source event, so a later
inbound can receive its own truthful status while reconciliation replay cannot
duplicate the same reply. Group threads do not use the personal projection;
they keep the existing neutral reset-only notice.

## Assistant Policy

`murph.plan_usage` accepts no arguments. Member identity comes from the signed
runtime callback, not from the model. Murph may call it only when a member asks
about their current plan or included usage, or when a trusted runtime
instruction requests one manual private check.

Do not turn this read into onboarding automation, a recurring threshold
watcher, or a group-chat money prompt. Do not name a group payer, invent a
balance, or use guilt, urgency, or scarcity language.

## Group Exhaustion

Classify group-thread exhaustion from the allowance source, never by comparing
its numeric cap with a trial cap. Group copy is neutral and reset-only. It must
not include an account link or mention Pulse, Edge, trials, upgrades, top-ups,
or who pays. Usage accounting does not own external group-thread egress, so it
does not send a proactive crossing message. The next current inbound is
preserved and receives the reset-only notice from the normal usage gate.

## Non-Goals

This feature adds no schema, second usage ledger, Stripe read, persisted
forecast, queue, cron, automatic nudge, group balance, top-up flow, or billing
mutation tool.

## Deployment

Deploy web before Cloudflare/runtime. Old runtimes simply omit the tool while
Settings can use the new web projection. During the short window before the
Cloudflare deploy, email and WhatsApp denied replies fail before provider
dispatch and remain retryable through their durable event claim. A new runtime
deployed against old web would advertise a callback that the old web does not
serve.

Existing billing mechanics remain in:

- `agent-docs/product-specs/pulse-trial-start-paid-pulse.md`
- `agent-docs/product-specs/hosted-plan-downgrades.md`
- `agent-docs/product-specs/hosted-family-plan.md`

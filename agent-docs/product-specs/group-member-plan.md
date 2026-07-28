# Group Member Plan

Last verified: 2026-07-27

Status: Implemented current-state contract

## Goal

Offer confirmed members of a canonical Murph group a direct
`launch_group_monthly` subscription for $3.50 per month. Group maps to the
existing `pulse` runtime plan. It changes only the included monthly AI
allowance; it does not create another capability tier, assistant personality,
wearable entitlement, member classification, or billing state machine.

The direct billing catalog is:

| Billing code | Display name | Runtime plan | Monthly price | Included AI usage |
| --- | --- | --- | ---: | ---: |
| `launch_group_monthly` | Group | `pulse` | $3.50 | $2.80 |
| `launch_monthly` | Pulse | `pulse` | $8 | $6.40 |
| `launch_edge_monthly` | Edge | `edge` | $20 | $16 |

Included usage remains 80% of the catalog recurring price. The explicit
default billing SKU for runtime `pulse` is `launch_monthly`; runtime capability
codes are never inverted to discover a member's current billing SKU.

## Independent Facts

Keep access, syncing, model capacity, and plan eligibility separate:

```ts
hasActiveAccess =
  memberHasActiveSubscription || memberHasActiveSponsorship;

canSyncWearables = hasActiveAccess;
canRunNewAiWork = hasActiveAccess && hasRemainingUsage;
canChooseGroupPlan = hasConfirmedGroupMembership;
```

Exhausted AI usage is not expired access. An active Group member whose
allowance is exhausted cannot begin new model-backed work, but wearable
ingestion, storage, device reconciliation, authorized group projections, and
challenge data continue under the existing active-access authority. Shared
group conversation model work continues to use the group/container allowance;
it is not charged to each participant's personal Group allowance.

## Eligibility And Visibility

`apps/web/src/lib/hosted-onboarding/billing-plan-eligibility.ts` is the single
eligibility owner. A member qualifies when at least one `HostedGroupMember` row
is an owner row or has a non-null `joinedAt`. Pending membership does not
qualify.

Group is visible in authenticated billing surfaces when at least one of these
facts is true:

- the configured Group Stripe price exists and current confirmed membership
  exists;
- Group is the current billing plan; or
- Group is the scheduled billing plan.

Public signup, invite preview and checkout, generic onboarding catalogs, and
group-chat surfaces omit Group. An unavailable card or unlock teaser is not
shown.

Visibility is not authorization. Every mutation that starts or schedules Group
rechecks confirmed membership while holding the existing member billing
mutation lock. Leaving the final group after purchase does not change,
cancel, or upgrade an active Group subscription. Current Group remains visible
as the member's current plan, but selecting it again after switching away
requires current confirmed membership.

No `isGroupUser` flag or new persistence is introduced.

## Billing Transitions

The direct-plan order is Group, Pulse, Edge. One policy selects either the
existing generic immediate-upgrade mechanism or the existing generic
period-end schedule mechanism:

| Change | Timing |
| --- | --- |
| Group to Pulse | Immediate and prorated |
| Group to Edge | Immediate and prorated |
| Pulse to Edge | Immediate and prorated |
| Edge to Pulse | Period end |
| Pulse to Group | Period end |
| Edge to Group | Period end |
| Pulse Trial to Group | Trial end, or now after explicit confirmation |
| Pulse Trial to Pulse | Trial end, or now after explicit confirmation |

Every transition reuses the canonical Stripe Customer, Subscription, billing
lock, invoice and payment evidence, idempotency, and price-based
reconciliation. Compatibility exports and routes may retain their historic
Pulse-specific names, but they delegate to the generic target-plan services.

The ordinary trial choice uses `at_trial_end`: the remaining trial continues
and the selected paid plan begins only when it ends. An immediate trial
conversion uses `now`, states the exact target price, states that the trial
ends and a charge begins immediately, and requires explicit confirmation.
Membership alone never selects or changes a plan.

## Trial Continuation

Everyone receives the existing Pulse Trial. There is no Group trial.

For a confirmed group member with a configured Group price, the trusted offer
contains Group and Pulse and recommends Group. Other members receive Pulse
only. The server owns this choice; the assistant mentions only plans present
in the trusted `availablePlans` projection.

`customer.subscription.trial_will_end` appends one durable
`assistant.notification.requested` mailbox item only when all of these are
true:

- the event resolves to the canonical direct member and trialing subscription;
- local billing still represents that Pulse Trial;
- the member has an active hosted crypto root; and
- a current direct private notification route exists.

The semantic dedupe key is
`trial-ending:<subscription-id>:<trial-end-unix-seconds>`. A changed trial end
may produce a new notice. The mailbox append and Stripe-event processing share
one transaction; the existing runtime is woken after commit. There is no group
fallback.

The notice says a renewal is scheduled only when the canonical subscription
has current payment tender or a Group continuation is already scheduled.
Otherwise it presents the available continuation choices without claiming an
automatic charge. The authenticated Settings surface remains the fallback when
private delivery is unavailable.

## Usage And Assistant Actions

Group never receives a personal usage-credit top-up offer in V1. At low or
exhausted Group usage, the recommended recurring action is Pulse. Copy must say
that new AI work is limited while wearable syncing and group activity continue.

`murph.plan_usage` may return:

- `planName: "Group"`;
- trusted `availablePlans` and `recommendedPlanCode`;
- a generic `change_plan` action with a server-issued target; and
- a signed, ten-minute quote.

The quote binds the member, current local billing state, target plan, exact
monthly price, timing, and expiry. `murph.subscription` verifies the quote
against a fresh read before atomically claiming the accepted private input.
The billing service then revalidates canonical state under its existing lock.
A stale or tampered quote cannot change billing.

Assistant behavior lives in the hosted low-usage/subscription skill, not the
global prompt. It must not infer Group eligibility from conversation history,
describe the member as inactive or low-value, claim syncing stopped because AI
usage was exhausted, or disclose billing in a group.

## Implementation Shape Decision

The first final-review baseline contains 3,011 authored-source additions and
516 deletions. The source churn is distributed across the complete gated
member journey:

| Surface | Added | Deleted |
| --- | ---: | ---: |
| Billing catalog, eligibility, Stripe transitions, and trial event adapter | 1,295 | 254 |
| Authenticated Web presentation and client actions | 699 | 135 |
| Usage, subscription-action, mailbox, and message projections | 561 | 58 |
| Shared hosted/assistant/Cloudflare contracts | 242 | 37 |
| Assistant skill | 50 | 32 |
| Design catalog | 157 | 0 |
| Local Stripe harness | 7 | 0 |

This is intrinsic feature scope, not review-driven growth. The implementation
continues as one rollout-gated PR for these reasons:

- A selectable Group SKU is incomplete without its eligibility recheck,
  transition policy, exhausted-usage behavior, and private action contract.
  Shipping those separately can expose a paid plan before every consumer can
  explain or safely mutate it.
- Trial-end selection, explicit immediate conversion, and the private
  `trial_will_end` reminder are the same continuation journey. They share one
  server-owned offer, quote, eligibility, and Stripe mutation authority rather
  than introducing independently deployable billing systems.
- Web, Cloudflare, and assistant changes are consumers of one strict target-plan
  contract. Splitting that contract across more stacked PRs would add temporary
  compatibility states and deployment orderings; it would not reduce runtime
  architecture.
- The frontend and design-catalog lines present and prove the same server-owned
  states. They add no policy or persistence owner.

The only new policy owners are the confirmed-membership eligibility module and
the signed quote codec. The quote is stateless and derives from existing
billing truth. The trial-ending adapter reuses the existing Stripe event,
mailbox, dedupe, route, and wake owners; it is not a scheduler or notification
state machine. Existing catalog, transition, reconciliation, usage projection,
and Stripe mutation owners are generalized rather than duplicated. No concept
can be deleted without removing an explicit launch requirement, and splitting
the PR would add rollout seams without deleting production code or state.

## Deployment

No application database migration is required. Configure the unique Group
monthly Stripe price as
`HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_GROUP_MONTHLY` before making Group
selectable.

Web owns the catalog, eligibility, quotes, Stripe mutations, and projection.
Cloudflare and assistant packages consume the target-plan action contract.
Deploy Web and the Cloudflare/assistant runtime together; the previous runtime
does not understand Group or the target-plan quote. Roll back the runtime and
Web together. Verify a real active Group account can exhaust AI usage while a
real wearable update still reconciles before broad rollout.

Privacy-safe rollout telemetry may count eligible views, selections,
conversions, exhaustion, Group-to-Pulse changes, retention, post-exhaustion
syncs, margin, and stale selection attempts. It must not include group names or
health data.

## Non-Goals

This feature adds no new group-only mode, capability plan, wearable rule,
Group-specific trial, per-group personal subscription, behavior-driven plan
switch, Group top-up, billing state machine, reminder scheduler, schema table,
public discounted-plan advertisement, or billing message in a group chat.

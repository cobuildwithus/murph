# Hosted Plan Downgrades

Last verified: 2026-07-15

## Goal

Maintain a clean Edge-to-Pulse plan switch that relies on Stripe for billing state, timing, invoices, and future subscription changes.

The product behavior is:

- Edge users can switch to Pulse from settings.
- The switch is scheduled for the next renewal, not applied immediately.
- Edge access remains active through the current paid billing period.
- Pulse access begins only after Stripe applies the scheduled phase.
- Murph stores only a small Stripe-derived read model for display and reconciliation.

## Current State

The app supports both the Pulse-to-Edge upgrade and the explicit Edge-to-Pulse
scheduled switch:

- `POST /api/settings/billing/upgrade-plan` accepts only `launch_edge_monthly`.
- `upgradeHostedBillingPlan` is upgrade-shaped and only permits `launch_monthly -> launch_edge_monthly`.
- `POST /api/settings/billing/switch-to-pulse` schedules `launch_edge_monthly -> launch_monthly` at the next renewal through `scheduleHostedBillingPlanSwitchToPulse`.
- `/settings` computes and renders both upgrade and switch actions when the current billing state makes them eligible.
- `Manage subscription` opens Stripe Customer Portal for payment methods, invoices, and other Stripe-managed account work.

The app-owned Edge-to-Pulse path is intentionally narrow; arbitrary plan
transitions still stay out of scope.

## Hosted Assistant Configuration

Active personal members can inspect and explicitly choose the assistant target
that Murph should use on the next hosted turn:

- Luna and Terra are available to every active personal member. Terra remains
  the default when no personal model override is stored.
- Synthetic thread-container runtimes use Sol by default from the existing
  thread-container relation. They have no writable or persisted model or
  reasoning preference.
- Settings keeps Luna and Terra editable for non-Edge personal members and
  explains that Sol requires paid Edge access. A paid Pulse member who is
  eligible for the direct upgrade sees the existing Edge upgrade action; other
  ineligible members see the Edge requirement without a billing action.
- Only an active, unsuspended personal member with direct paid Edge access or an
  active paid Family Edge assignment can choose Sol. Family Pulse assignments,
  direct Pulse, and trials do not qualify. Synthetic thread-container members
  receive their derived Sol target but cannot mutate or persist a preference.
- The common reasoning choices are `low`, `medium`, `high`, and `xhigh`. `low`
  is the default when no reasoning override is stored.
- Postgres stores nullable non-default model and reasoning intent only for the
  personal member. It is the only durable owner; the vault, hosted workspace
  snapshot, and assistant runtime do not keep a second preference. The
  thread-container Sol target remains derived rather than stored.
- A scheduled switch to Pulse keeps Sol available until Stripe applies the
  Pulse phase and reconciliation changes the current billing state. After that
  boundary, Terra is effective while the stored Sol intent remains available
  for a later Edge reactivation.
- The signed workspace read projects either an eligible personal member's
  non-default model and reasoning effort or the relation-derived thread-container
  Sol model to the runner at the next hosted invocation boundary. This is also
  the activation boundary for changes made through Settings. An already-active
  invocation can retain that snapshot through its bounded 180-second idle
  window, so Settings states that an idle run can take up to three minutes to
  close.
- A confirmed `murph.assistant_configuration` update is different: its
  authoritative full web response becomes an ephemeral target for the next
  separately accepted provider turn, including a follow-up serviced by the
  same active invocation. The running turn keeps the target it started with;
  the tool never mutates it in place. Only `updated` and `unchanged` responses
  may refresh that projection. Failure statuses leave it unchanged, and a new
  invocation always rereads the web-owned preference. At idle shutdown, a
  model or reasoning change does not replace the engine-owned warm thread.
  The next separately accepted turn resumes that same native Codex thread and
  applies both settings on `turn/start`. Compaction usage is attributed from
  the model actually bound to the thread, never the future preference, and
  provider work is skipped when that bound model cannot be priced.
- Configuration updates require an explicit personal-member choice. The
  authenticated Settings form uses its normal session and CSRF boundary. An
  assistant-driven update additionally requires eligible accepted user input
  for that turn. The runtime forwards the terminal input id from its locally
  revalidated bounded exact-successor provider batch, and web binds it to the
  callback member plus one live conversation mailbox row inside the matching
  field-level preference-write transaction. This low-risk preference update
  does not require a passkey or browser handoff; missing or ambiguous input
  authority fails closed.
  Murph may suggest Luna or an Edge upgrade, but it must not switch model or
  reasoning effort automatically because usage is low or exhausted.
- Changing the preference does not create a mailbox item, wake, queue, or a
  second runtime state machine.

Conversation style remains independently available through
`murph.personalization`, which atomically reads or updates the private member's
tone and voice and may report the same model resolver's current context. It does
not write model or reasoning preferences. Conversation model and reasoning
changes use the input-bound `murph.assistant_configuration` owner, so the style
path cannot bypass the configuration owner.

The approval simplification is fully deployed: both the runtime and web accept
only the direct input-bound request. Configuration-specific approval helpers
and the legacy exact-target request shape no longer exist. Generic secure
approval remains independently owned by sensitive actions such as vault-file
delivery.

## Included Usage Behavior

Monthly included AI allowance remains a measured billing and product signal,
not a runtime access gate for an otherwise active member. Murph continues to
record usage, attribute the requested and served model reported by Codex App
Server, and send the existing period-scoped usage notice, while conversation
and eligible system work continue after the allowance is exhausted. This also
applies to the in-window Pulse Trial allowance: its 4.50 USD amount remains the
trial-period accounting and notice threshold, not a provider-start gate.
Foreground model-work admission uses the hosted member-access owner only;
usage-period reads, creation, locks, and spend are post-usage work. Inactive,
suspended, and malformed or expired trial entitlement still fail closed.
Message-triggered usage carries its originating Linq or Telegram reply target
only through the current invocation and signed usage-record seam so the notice
returns to that conversation. Before claiming delivery, web re-authorizes a
personal Linq or Telegram target against the member's current routing binding
and an external Linq target against its persisted thread authority. Automation
and system work without an originating conversation retain the personal
Linq-home fallback; the delivery target is not persisted as a second routing
authority. The optional callback field is intentionally tri-state: omission
means there was no accepted conversation and permits that legacy home fallback;
explicit `null` means accepted input had no single safe route and must perform
no route lookup, claim, or send; an object requests only that exact originating
route. Producers and consumers must preserve omission versus `null`.
If a notice attempt fails, later counted usage in the same over-limit period may
retry the same period-scoped claim; the existing delivery idempotency boundary
still permits at most one completed notice.

This advisory policy does not weaken other access or abuse controls. The
member-access owner validates trial phase, offer, policy, and time bounds on
model-capable admission; active Family sponsorship still overrides stale own
billing, and synthetic thread containers retain owner-or-participant access.
The separate daily Linq anti-abuse quota remains enforceable. Temporal consumes
the member-access decision directly, with no separate runtime usage-gate
callback. Cloudflare/runner #587 or newer is the permanent rollback floor for a
Web build that omits the retired route.

### Deployment And Compatibility

Deploy this additive path in the following order:

1. Apply the nullable Postgres migration.
2. Deploy web first and wait until every serving web instance is on the new
   version. This establishes the configuration and personalization callbacks
   plus the compatibility consumer that accepts and honors an originating
   usage-notice target before Cloudflare can produce one. Do not continue while
   an old web instance can still accept usage records.
3. Deploy Cloudflare. The new runtime consumes the optional workspace model
   and reasoning fields, advertises the conversational configuration and style
   tools, and begins producing originating usage-notice targets.
4. After both deployments are current, run the count-only dry run and then the
   fixed-campaign apply form of
   `pnpm --dir apps/web runtime:recheck-usage-advisory`. This sends the existing
   `runtime_recheck_requested` signal to every active hosted workspace so a
   workflow that entered a durable monthly-allowance wait before rollout
   immediately re-reads the now-advisory gate. A nonzero failed-signal count is
   a failed rollout step; rerun the idempotent operation until it reports zero.

An old Cloudflare consumer already accepts the optional model override and
ignores an unknown optional reasoning override, so the web-first compatibility
phase preserves saved intent without breaking invocation. A reasoning change
saved during that short phase may keep the old runtime default until
Cloudflare is current; the durable preference is not lost and then applies on
the next new invocation. Cloudflare must not deploy first: the old web usage
parser silently discards an originating notice target and could complete the
period claim against the wrong fallback route. Web-first rollout makes the
producer/consumer boundary additive without a second feature flag or durable
capability state.

The feature selects initial per-invocation overrides through the existing
forwarded `HOSTED_ASSISTANT_MODEL` and
`HOSTED_ASSISTANT_REASONING_EFFORT` environment keys. After a confirmed
conversational update, current runner bundles project the returned full target
through those same keys for later assistant phases and let the existing session
resolution start the next Codex turn with it. This adds no second runner command
or model-config parser. Current runner bundles already accept Luna, Terra, Sol,
and the common reasoning values. Old runner bundles safely retain the prior
next-invocation activation behavior until rollout replaces them.
The group-chat default is a web-side derivation over the same optional model
override: it requires no persisted preference or separate consumer behavior,
and a web rollback returns thread-container runtimes to the fleet model on their
next invocation.
The feature is safe under gradual container rollout and adds no requirement for
`container_rollout=immediate`. Production deploys must still honor the existing
global rollout preflight in `apps/cloudflare/DEPLOY.md`, which currently requires
immediate rollout for the GPT-5.6 fleet and selector-scope compatibility.

Feature rollback may restore the pre-feature Cloudflare consumer while the new
web version remains; the additive nullable columns may remain. To restore the
pre-feature web version, roll Cloudflare back first and wait until the old
runtime producer is current, then roll web back. That order prevents a new
Cloudflare usage target from reaching an old web parser. A rollback that no
longer projects the saved values returns execution to the platform-configured
model and reasoning defaults without deleting member intent. This feature has
no model-specific fallback or rollback path.

Focused contract coverage proves old/no-field compatibility, personal-member
Luna/Terra/Sol eligibility, the common reasoning values, same-invocation
next-turn projection and default reset, the relation-derived thread-container
Sol default, and private-member tone/voice reads and writes. The normal deploy
keeps its managed-container fingerprint and live Terra smoke. An optional
post-deploy canary may save one non-default target for an eligible personal
member through the approved configuration flow, confirm a same-invocation
follow-up reports it, update style through personalization, and verify usage
retains both requested-model and served-model attribution.

## First-Version Scope

Keep the implemented first version intentionally narrow.

The supported transition is:

- Edge paid subscription to Pulse at renewal.

Do not build:

- a generic plan-transition engine
- arbitrary `targetPlanCode` routing
- in-app schedule reversal
- Customer Portal plan switching
- local timers or cron-based entitlement changes
- switch-request entitlement, current plan, usage allowance, usage period, or
  runner-state updates

Future plan changes can generalize after this path is proven in Stripe test clocks and production.

## Stripe Constraints

Use Stripe as the source of truth, but do not use Customer Portal plan switching for this plan switch.

Stripe Customer Portal supports scheduled downgrades in general, but the app keeps this in-product switch explicit so pending state, schedule compatibility, and allowance reconciliation stay under Murph control.

`subscription_update_confirm` is also not a fit because Stripe currently allows only one item in that flow and says subscriptions with multiple items cannot be updated through it.

Stripe Subscription Schedules are the correct Stripe-owned primitive for this behavior. They are designed for future subscription changes, including downgrades, and phase metadata updates the underlying subscription metadata when a phase starts.

Relevant Stripe docs:

- Customer Portal configuration: https://docs.stripe.com/customer-management/configure-portal
- Customer Portal limitations: https://docs.stripe.com/customer-management
- Portal deep links: https://docs.stripe.com/customer-management/portal-deep-links
- Subscription schedules: https://docs.stripe.com/billing/subscriptions/subscription-schedules

## Product Policy

Supported transition:

- `launch_edge_monthly -> launch_monthly`

Unsupported transitions:

- Pulse to Pulse
- Edge to Edge
- trial-state switches
- switches without a Stripe customer and subscription
- switches while a conflicting Stripe schedule is already attached

Downgrade timing:

- Always schedule at current period end.
- Do not issue immediate prorated credits or immediate allowance reductions.
- Do not reduce usage allowance until Stripe applies the Pulse phase and the webhook reconciliation updates the local billing read model.

User-facing language:

- Prefer "Switch to Pulse" over "Downgrade."
- Confirmation title: "Switch to Pulse at renewal."
- Confirmation body: "You will keep Edge until <date>. Pulse starts after this billing period at $8/month."
- Pending state: "Pulse starts on <date>. Edge remains active until then."

## Backend Design

Add a single-purpose route:

```txt
POST /api/settings/billing/switch-to-pulse
```

The first version does not need a request body. The route itself is the command.

The route must:

- enforce hosted mutation origin checks
- require the Murph hosted app session
- reject suspended members
- read the member billing ref
- validate Edge-to-Pulse eligibility
- call the billing schedule service
- return scheduled switch state

Suggested response:

```ts
type HostedBillingPlanSwitchResult =
  | {
      status: "already_scheduled";
      scheduledBillingPlanCode: "launch_monthly";
      effectiveAt: string;
    }
  | {
      status: "scheduled";
      scheduledBillingPlanCode: "launch_monthly";
      effectiveAt: string;
    };
```

Add a narrow eligibility helper:

```ts
function canSwitchHostedBillingPlanToPulse(input: {
  billingStatus?: unknown;
  currentBillingPhase?: unknown;
  currentBillingPlanCode?: unknown;
  stripeCustomerId?: unknown;
  stripeSubscriptionId?: unknown;
  suspendedAt?: unknown;
}): boolean;
```

Eligible means:

- `currentBillingPlanCode` is `launch_edge_monthly`
- `currentBillingPhase` is `paid`
- hosted member has active access
- hosted member is not suspended
- billing ref has Stripe customer and subscription refs

Do not separately reject historical Pulse trial checkout-offer metadata when `currentBillingPhase` is `paid`. Converted trial subscriptions may preserve the historical offer, and the billing phase is the entitlement signal.

The service should still verify Stripe directly before scheduling. Local eligibility is a display and early-reject hint, not the final authority.

## Stripe Schedule Service

Implement a dedicated service instead of extending the existing upgrade-shaped service with broad transition logic.

Suggested service:

```ts
async function scheduleHostedBillingPlanSwitchToPulse(input: {
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
}): Promise<HostedBillingPlanSwitchResult>;
```

Algorithm:

1. Load member core state and billing ref.
2. Require active access and paid Edge local state.
3. Require Stripe customer and subscription ids.
4. Load Stripe recurring plan config for Edge and Pulse.
5. Retrieve the Stripe subscription with `items.data.price` expanded.
6. Confirm the subscription customer matches the billing ref customer.
7. Reject if Stripe shows:
   - subscription status is not `active`
   - subscription is trialing, paused, unpaid, past due, incomplete,
     incomplete expired, or canceled
   - subscription has `cancel_at_period_end`
   - subscription has a pending update
   - subscription current period end is missing, invalid, or not in the future
   - subscription attached schedule is present but is not the same compatible
     app-authored switch
8. Confirm the canonical Stripe items represent exactly the v1 hosted Edge
   subscription shape. Use configured Stripe price ids for this service and for
   the central subscription reconciliation path that writes
   `currentBillingPlanCode`.
9. If `subscription.schedule` is present, retrieve it.
10. Return `already_scheduled` only if the attached schedule is active,
    app-authored, attached to the same subscription, targets Pulse at the same
    current period end, and has the expected Edge current phase plus Pulse future
    phase. Persist any missing pending display fields before returning.
11. Reject all other attached schedules with a safe "billing change already
    scheduled" conflict and direct the user to support. Do not update, release,
    or reinterpret Dashboard-created, Portal-created, or otherwise unknown
    schedules in the first version.
12. Otherwise create or idempotently recover a subscription schedule from the
    subscription using `from_subscription`.
13. Retrieve the schedule after creation.
14. Update the schedule by passing all current and future phases required by
    Stripe.
15. Current phase:
    - start from the current phase returned by Stripe
    - preserve non-plan phase/default fields that must remain set
    - keep the Edge recurring price
    - end exactly at the subscription current period end
16. Future phase:
    - start exactly at subscription current period end
    - use the Pulse recurring price
    - last one billing interval
    - set phase `proration_behavior` to `none`
    - set metadata for Pulse and clear trial-shaped metadata keys
17. Set top-level schedule update `proration_behavior` to `none`.
18. Set `end_behavior` to `release`.
19. Store the returned schedule id and pending display fields in the local
    billing read model only after Stripe returns the updated schedule.

Important schedule rules:

- Include only the hosted recurring price in each phase.
- Do not use `end_behavior: "cancel"` for downgrades.
- Do not mutate the subscription directly while a schedule owns the pending change.
- While a switch is pending, the first version should reject additional in-app plan changes rather than trying to merge intents.
- Treat the initial request as scheduling only. It must not call the subscription
  event reconciler or update current entitlement, current plan, usage allowance,
  usage period, or runtime state. Entitlement changes, usage allowance reduction,
  and Temporal runtime signals happen only after subscription reconciliation
  observes Stripe's applied Pulse prices.

First version supports only canonical hosted subscriptions with exactly the known hosted plan items:

- one configured Edge recurring price

Reject subscriptions with unknown active licensed items, duplicate known recurring items, non-month recurring intervals, unsupported quantities, or unmarked metered add-ons. Marked legacy hosted AI usage metered items may be dropped by the schedule update; do not silently preserve unknown add-ons into the future phase.

Schedule creation is a two-step Stripe operation because `from_subscription` cannot be combined with phase values. The service must be retry-safe across:

- creating or idempotently recovering a schedule from the subscription
- updating the schedule with app metadata and phases
- writing local pending display fields

Use a deterministic Stripe idempotency key based on member id, subscription id, target switch, and subscription current period end.

If Stripe schedule creation succeeded but local persistence failed, a repeat request must detect the compatible attached schedule, persist the pending display fields, and return `already_scheduled`.

If schedule creation succeeded but phase update failed, a repeat request must either recover the same app-created schedule through the same idempotency key and finish the update, or reject with an operator-repair conflict. Do not leave the user behind an attached but unconfigured schedule with no recovery path.

## Local Read Model

Add only Stripe-derived pending display fields to `HostedMemberBillingRef`:

- `stripeSubscriptionScheduleLookupKey`
- `stripeSubscriptionScheduleIdEncrypted`
- `scheduledBillingPlanCode`
- `scheduledBillingEffectiveAt`

These fields are pending-display and reconciliation hints only. They are not
entitlement state.

Clear all four fields when the schedule is released, completed, canceled,
aborted, no longer attached, no longer compatible, or when subscription
reconciliation writes the current plan as Pulse. Discard the encrypted schedule
id after release.

The current entitlement source remains:

- current Stripe subscription state
- webhook reconciliation into `currentBillingPlanCode`
- current period fields
- current billing phase

Do not add a local schedule status enum, downgrade timer, cron, or app-owned
transition state machine.

## Webhooks And Reconciliation

Entitlement changes must come from Stripe subscription reconciliation, not from the switch request.

Keep `customer.subscription.updated` and invoice reconciliation as the path that
changes current plan and usage allowance.

Schedule webhooks are for pending display cleanup and refresh only:

- `subscription_schedule.released`, `subscription_schedule.completed`, `subscription_schedule.canceled`, and `subscription_schedule.aborted`: clear pending fields only when the schedule lookup key matches the local pending schedule.
- `subscription_schedule.updated`: refresh pending fields only when the lookup key already matches and the schedule still represents the same Edge-to-Pulse switch; otherwise clear pending fields.
- `subscription_schedule.created`: do not create local pending state by default. The switch request writes pending display fields, and retrying the request can self-heal if the local write failed.
- `subscription_schedule.expiring`: ignore for this feature.

When the scheduled phase starts and Stripe updates the subscription to Pulse:

- subscription reconciliation updates `currentBillingPlanCode` to `launch_monthly`
- pending schedule fields are cleared
- usage allowance resolves to Pulse
- Temporal runtime signals happen after committed entitlement change, not during
  the initial schedule request

Do not create local pending state from a schedule webhook based only on Stripe metadata.

This feature updates only the central subscription reconciliation needed to
detect Pulse from configured recurring price ids after the scheduled
phase applies, even if metadata is missing or stale. Do not do a broad global
plan-detection refactor in this feature.

## Settings UI

The Billing card should stay a single calm summary surface.

When current plan is Edge and no switch is pending:

- show current plan: Edge
- show price: `$20 / month`
- show action: `Switch to Pulse`
- keep `Manage subscription`

When switch is pending:

- show current plan: Edge
- show status: `Pulse starts on <date>. Edge remains active until then.`
- show next price from the hosted plan registry: `Then $8 / month`
- hide `Switch to Pulse`
- keep `Manage subscription` for invoices, billing details, and payment methods
- do not imply Stripe Portal can reverse or cancel the scheduled switch
- show a short support line for users who want to keep Edge

Confirmation dialog:

- follow `DESIGN.md`: cream surface, warm hairline borders, no shadow treatment, no nested cards
- use `outline` or quiet secondary styling for the switch action
- keep primary sage for forward upgrades, not for the quieter switch-to-Pulse action

Avoid adding a second complex pricing component. A flat row or short muted status line is enough.

## Reversal

Do not include in-app reversal in the first version.

If a user wants to keep Edge after scheduling the switch, direct them to support. Support releases the Stripe schedule. Pending local display fields clear only after the matching `subscription_schedule.released` webhook or manual reconciliation confirms the release.

Do not expose `Manage subscription` as the reversal path. Do not add a `Keep Edge` route until the product explicitly wants a second billing mutation.

## Verification

Required tests:

- route preserves origin, app session, suspended-member, and active-member checks
- route has no generic target body and schedules only Edge-to-Pulse
- local paid Edge eligibility passes
- trial, non-paid, inactive, suspended, and missing Stripe refs reject
- service rejects customer mismatch
- service rejects non-active Stripe subscription states
- service rejects `cancel_at_period_end`
- service rejects pending update
- service rejects existing foreign schedule
- service rejects missing, duplicate, unknown, or mismatched subscription items
- service creates schedule from subscription with deterministic idempotency key
- service updates phases with Edge current prices and Pulse future prices
- both phases include only the hosted recurring price
- top-level and future phase proration behavior are `none`
- future phase metadata sets Pulse and clears trial metadata
- duplicate request returns `already_scheduled`
- retry after schedule-created/local-write-failed self-heals
- pending display fields are written after successful schedule update
- schedule lifecycle webhooks clear or refresh only matching pending fields
- `customer.subscription.updated` with Pulse recurring price id updates current plan to Pulse and clears pending fields
- usage allowance remains Edge before phase start and becomes Pulse only after subscription reconciliation
- settings renders Edge, Switch to Pulse, pending switch, and reconciled Pulse

Do not add broad out-of-order older Stripe event handling to this feature unless
it is scoped specifically to matching schedule pending fields. Global webhook
freshness belongs in the reconciliation system, not this plan switch.

Stripe sandbox acceptance:

- create canonical Edge subscription with exactly the Edge recurring item
- schedule switch to Pulse at current period end
- verify schedule has two phases and `end_behavior: "release"`
- verify no duplicate recurring items
- advance Test Clock to the phase boundary
- verify subscription now has the Pulse recurring price
- verify schedule releases or completes and the subscription continues as Pulse
- replay webhooks and verify settings, billing ref, and usage allowance converge

Deployment checks:

- production has both recurring price env vars
- webhook endpoint includes subscription and schedule events
- backend deploy lands before UI exposure
- consider a feature flag or server-side allowlist for first production test

## Open Questions

- Are there any historical Stripe subscriptions with legacy metered items that should be cleaned up manually before enabling broad in-app downgrades?

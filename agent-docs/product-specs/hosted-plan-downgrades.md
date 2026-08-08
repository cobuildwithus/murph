# Hosted Scheduled Plan Changes

Last verified: 2026-08-08

## Goal

Maintain narrow direct-plan changes that rely on Stripe for billing state,
timing, invoices, and future subscription changes.

The product behavior is:

- Edge users can switch to Pulse from settings.
- The switch is scheduled for the next renewal, not applied immediately.
- Edge access remains active through the current paid billing period.
- Pulse access begins only after Stripe applies the scheduled phase.
- Murph stores only a small Stripe-derived read model for display and reconciliation.

## Current State

The app supports immediate upgrades and explicit renewal-bound changes:

- `POST /api/settings/billing/upgrade-plan` accepts Pulse or Edge targets.
- `upgradeHostedBillingPlan` permits Group to Pulse or Edge and Pulse to Edge.
- `POST /api/settings/billing/switch-plan` schedules an eligible Group or Pulse
  target at the current paid period end.
- the historical Edge-to-Pulse route and service remain compatibility delegates;
- `/settings` computes and renders only transitions admitted by the shared
  server policy.
- `Manage subscription` opens Stripe Customer Portal for payment methods, invoices, and other Stripe-managed account work.

The transition graph is explicit. Arbitrary plan-code routing, reversal, and
merging with foreign schedules stay out of scope.

## Hosted Assistant Configuration

Active personal members and authenticated group-room runtimes can inspect and
explicitly choose the assistant target that Murph should use on the next hosted
turn:

- OpenAI is the default core assistant provider. When the operator-controlled
  Venice rollout flag is enabled, an active personal member may choose Venice
  instead. The choice changes core assistant inference only; specialized tools
  can continue to use their own managed providers.
- Settings may state that Murph disables OpenAI response storage because the
  direct Responses path sends `store: false`, which [disables Responses API
  storage](https://developers.openai.com/api/docs/guides/migrate-to-responses#4-decide-when-to-use-statefulness).
  This does not promise zero data retention: OpenAI separately documents
  [abuse-monitoring, prompt-cache, and endpoint retention
  controls](https://developers.openai.com/api/docs/guides/your-data#v1responses),
  and third-party tools remain subject to their own retention policies.
- Settings may call Venice privacy-first and state that Venice stores no prompts
  or replies, consistent with [Venice's API privacy
  documentation](https://docs.venice.ai/welcome/privacy). This is a
  Venice-layer disclosure, not a Murph-enforced privacy mode: Murph does not
  inspect or lock the operator-mapped model's privacy badge, and the setting
  must not imply E2EE, TEE, or a broader upstream retention or training
  guarantee.
- Luna and Terra are available to every active personal member. Terra remains
  the default when no personal model override is stored.
- Synthetic thread-container runtimes use Sol by default from the existing
  thread-container relation. An explicit current-room request may choose Luna,
  Terra, or Sol for that room through `murph.assistant_configuration`. Group
  provider and reasoning remain fixed to OpenAI and `low`; the tool never reads
  or changes a participant's private configuration.
- Settings keeps Luna and Terra editable for non-Edge personal members and
  explains that Sol requires paid Edge access. A paid Pulse member who is
  eligible for the direct upgrade sees the existing Edge upgrade action; other
  ineligible members see the Edge requirement without a billing action.
- Only an active, unsuspended personal member with direct paid Edge access or an
  active paid Family Edge assignment can choose Sol for their personal runtime.
  Family Pulse assignments, direct Pulse, and trials do not qualify. Synthetic
  thread-container runtimes keep their existing relation-derived Sol default and
  may choose any supported room model without reading personal plan state.
- The common personal reasoning choices are `low`, `medium`, `high`, and
  `xhigh`. `low` is both the personal default and the fixed group-room value.
- Postgres stores nullable provider, model, and reasoning intent on the existing
  `HostedMember` row. It remains the only durable owner; the vault, hosted
  workspace snapshot, and assistant runtime do not keep a second preference.
  For a personal member, a null model means Terra. For a synthetic
  thread-container member, null means the relation-derived Sol default, while an
  explicit Luna or Terra room choice uses the same existing model field. No
  group-settings table, migration, or second state machine is added.
- A scheduled switch to Pulse keeps Sol available until Stripe applies the
  Pulse phase and reconciliation changes the current billing state. After that
  boundary, Terra is effective while the stored Sol intent remains available
  for a later Edge reactivation.
- The signed workspace read projects an eligible personal member's provider,
  model, and reasoning effort or a synthetic thread-container's resolved room
  model to the runner at the next hosted invocation boundary. If Venice is
  disabled, a stored personal Venice preference resolves to OpenAI without
  deleting member intent. This remains the activation boundary for changes made
  through Settings. After an effective provider change commits, Settings sends
  a bounded payloadless Temporal runtime-wake signal. Temporal coalesces
  duplicate provider wakes and asks the existing Cloudflare adapter to process
  one even when reconciliation facts are idle. A warm invocation compares its
  provider snapshot with the live Web-owned preference, checkpoints immediately
  when they differ, and returns the existing immediate-recheck edge so a fresh
  invocation adopts the saved provider before the next message. Signal failure
  does not undo the durable save: the next invocation and the provider-entry
  revalidation remain correctness backstops. Model-only and reasoning-only
  changes keep the existing warm-invocation behavior.
- A confirmed `murph.assistant_configuration` update is different: its
  authoritative full web response becomes an ephemeral target for the next
  separately accepted provider turn, including a follow-up serviced by the
  same active invocation. The running turn keeps the target it started with;
  the tool never mutates it in place. Only `updated` and `unchanged` responses
  may refresh that projection. Failure statuses leave it unchanged, and a new
  invocation always rereads the web-owned preference. At idle shutdown, a
  model or reasoning change does not replace the engine-owned warm thread.
  The next separately accepted turn resumes that same native Codex thread and
  applies the saved target on `turn/start`. Compaction usage is attributed from
  the model actually bound to the thread, never the future preference, and
  provider work is skipped when that bound model cannot be priced.
- Configuration updates require an explicit personal-member or current-room
  choice. The authenticated Settings form uses its normal session and CSRF
  boundary. An assistant-driven update additionally requires eligible accepted
  user input for that turn. The runtime forwards the terminal input id from its
  locally revalidated bounded exact-successor provider batch, and web binds it
  to the callback member plus one live conversation mailbox row inside the
  matching field-level preference-write transaction. For a group room, that
  callback member is the existing synthetic thread-container member, so the
  write is room-scoped without participant identity inference. This low-risk
  preference update does not require a passkey or browser handoff; missing or
  ambiguous input authority fails closed.
  Murph may suggest Luna or an Edge upgrade, but it must not switch model or
  reasoning effort automatically because usage is low or exhausted.
- Changing a preference does not create a mailbox item, queue, or second runtime
  state machine. An effective provider change from authenticated Settings sends
  only `runtime_wake_requested`; unchanged, model-only, and reasoning-only saves
  do not. Existing `runtime_recheck_requested` callers remain facts-only.

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

The web-owned access-and-usage decision is the single provider-start gate.
Usage-bearing work is blocked after the member exhausts both the current
period's included allowance and any purchased usage credit. The operation that
crosses the remaining allowance may finish; later accepted input stays pending
until capacity is restored instead of being discarded.

Settlement consumes included allowance first and then purchased credit through
the append-only usage-credit ledger and its bounded member projection. Credit
carries forward, but it never creates or restores plan entitlement. Trials are
also usage-enforced and cannot buy credit. Inactive, suspended, canceled,
malformed, or expired entitlement still fails closed, and the separate daily
Linq anti-abuse quota remains independently enforceable.

Message-triggered usage preserves the existing tri-state originating-route
contract for the period-scoped limit notice: omission permits the personal
Linq-home fallback, explicit `null` permits no route lookup or send, and an
object requests only the re-authorized originating route. If delivery fails,
later counted usage in the same exhausted period may retry the claim, while the
delivery idempotency boundary permits at most one completed notice.

Synthetic thread containers remain subject to the same web-owned usage block.
Authenticated contributors may fund a group through the separate fixed-pack
usage-credit flow, but group notices must not expose a personal member's
billing, plan, purchase, or receipt details. Temporal and the runner receive no
billing or credit decision. Web blocks runtime reconciliation and mailbox fetch
before exhausted usage-bearing work reaches the runner; Temporal owns only the
resulting orchestration state.

### Deployment And Compatibility

Venice activation is an operator-gated addition to the established
configuration rollout below:

1. Apply the nullable `assistantProviderPreference` Postgres migration.
2. Deploy Web with `HOSTED_VENICE_ENABLED` unset or disabled. This version can
   store and parse the preference while continuing to project OpenAI.
3. Configure the selected GitHub environment with `VENICE_API_KEY` and all
   three fixed `HOSTED_VENICE_{LUNA,TERRA,SOL}_MODEL` variables, then deploy
   Cloudflare and the runner with `container_rollout=immediate`. Deploy
   preflight rejects a partial Venice group.
4. Verify the exact runner fingerprint and a controlled Venice turn, then
   enable `HOSTED_VENICE_ENABLED` in Web and redeploy Web to expose the choice.

Rollback hides the choice first by disabling `HOSTED_VENICE_ENABLED` and
redeploying Web. New invocations then project OpenAI even when a nullable
Venice preference remains stored. Only after that Web state is serving may the
Venice Worker secret or model mappings be removed or the Cloudflare bundle be
rolled back. No backfill, second preference owner, or compatibility queue is
required.

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

Focused contract coverage proves old/no-field compatibility, gated
OpenAI/Venice resolution, personal-member Luna/Terra/Sol eligibility, the
common reasoning values, same-invocation next-turn projection and default
reset, the relation-derived thread-container Sol default plus explicit
room-scoped Luna/Terra/Sol switching, fixed Venice model translation at the
Worker boundary, and private-member tone/voice reads and writes. The normal
deploy keeps its managed-container fingerprint and live OpenAI Terra smoke.
Before the Web flag is enabled, a post-deploy canary must exercise one
controlled Venice turn through the exact Worker/runner path. A later
configuration canary may save one non-default target for an eligible personal
member, confirm a same-invocation follow-up reports it, update style through
personalization, and verify usage retains both requested-model and served-model
attribution.

## Current Scope

Keep the implemented transition graph intentionally narrow.

Supported scheduled transitions:

- paid Pulse to eligible Group at renewal;
- paid Edge to Pulse or eligible Group at renewal.

Do not build:

- an open-ended plan-transition engine
- unvalidated `targetPlanCode` routing
- in-app schedule reversal
- Customer Portal plan switching
- local timers or cron-based entitlement changes
- switch-request entitlement, current plan, usage allowance, usage period, or
  runner-state updates

## Stripe Constraints

Use Stripe as the source of truth, but do not use Customer Portal plan switching for this plan switch.

Stripe Customer Portal supports scheduled downgrades in general, but the app keeps this in-product switch explicit so pending state, schedule compatibility, and allowance reconciliation stay under Murph control.

`subscription_update_confirm` owns immediate paid-plan upgrades after the
retired hosted-AI metered items are removed and each eligible direct
subscription has one licensed item. It does not own the scheduled transitions
in this spec: Stripe Subscription Schedules remain the correct primitive for
end-of-period downgrades and Group switches.

Stripe Subscription Schedules are the correct Stripe-owned primitive for this behavior. They are designed for future subscription changes, including downgrades, and phase metadata updates the underlying subscription metadata when a phase starts.

Relevant Stripe docs:

- Customer Portal configuration: https://docs.stripe.com/customer-management/configure-portal
- Customer Portal limitations: https://docs.stripe.com/customer-management
- Portal deep links: https://docs.stripe.com/customer-management/portal-deep-links
- Subscription schedules: https://docs.stripe.com/billing/subscriptions/subscription-schedules

## Product Policy

Supported scheduled transitions:

- `launch_monthly -> launch_group_monthly` while paid;
- `launch_edge_monthly -> launch_monthly`;
- `launch_edge_monthly -> launch_group_monthly`.

Unsupported transitions:

- same-plan changes
- Group to a lower plan
- Starter members scheduling a future plan change; Starter begins an eligible paid
  plan through ordinary checkout instead
- Group selection without confirmed current membership
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

The service supports only canonical hosted subscriptions with exactly one
configured recurring Price for the current direct plan.

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

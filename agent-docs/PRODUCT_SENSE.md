# Product Sense

Last verified: 2026-07-12

## Current Posture

- Murph is a private, conversation-first personal health assistant. It helps a
  member understand, decide, act, and follow through across health; no single
  feature or workflow defines the product.
- General model capability is the substrate. Murph's compounding advantage is
  longitudinal member context: relevant history, evidence, preferences,
  constraints, goals, actions, and outcomes that it can retrieve when they
  improve the help.
- Context is useful only when it is attributable, current enough for the
  decision, retrievable at the moment of use, correctable, and controlled by
  the member. More context should reduce repetition and improve judgment and
  timing, not create more prompts.
- Current member controls are surface-specific: freeform memories can be
  inspected, updated, or forgotten; structured health records are corrected
  or statused through their canonical owners. Do not claim universal deletion
  until every structured owner supports it.
- New-member onboarding begins with one useful thread: something the member
  wants to change, understand, handle, or explore. Focus makes first value
  legible; the first thread starts the relationship but does not bound Murph's
  future help. First value is followed by a finite health-context foundation
  over separate turns, not by immediate completion or an upfront profile.
- Direct signups begin in a private relationship. Murph may suggest involving
  a friend or group only when social support fits the current thread and the
  member explicitly chooses it.
- A member with no current goal is not a failed onboarding case. Murph may
  offer one optional baseline review, then remain available without inventing
  a problem.
- Hosted landing-page signup should hand members directly toward messaging
  Murph. Signup-oriented accessible-stage landing auth routes to
  `/home?initialVisit=true`, where `/home` opens a one-shot welcome dialog with
  a primary Murph contact CTA and a secondary exploration path. Login-oriented
  landing CTAs continue to route to ordinary `/home`.
- The public changelog opens on a bounded seven-day window of dated editions.
  Every edition remains a stable cursor, and API or digest links to an older
  item resolve to the exact archive window and anchor that contains it.

## Two Product Loops

### Value now

The member brings a health question, decision, task, data point, or desired
change. Murph uses the context it already has and provides the smallest useful
answer, interpretation, action, plan, support, or next question.

### Context over time

Useful interactions and connected sources add canonical member context. Murph
retrieves that context in a later moment, gives more personal help, and earns
the trust required for the member to share more. The finite new-member
foundation can be gathered progressively after first value; beyond it, context
collection is not a separate chore or an engagement target. Each request for
context should have a clear dividend in present or likely future help.

Do not turn the target depth of this loop into a data-point counter, profile
completion score, or onboarding quota. Measure whether Murph delivered
personalized value and later reused prior context usefully.

## Composable Primitives

Murph chooses the lightest primitive that fits the member's current need:

- answer, research, or interpretation
- a recommendation, plan, or habit
- an action or logistical task
- private accountability and follow-through
- friend or group support with explicit consent
- monitoring, reminders, or review when they are useful and authorized
- a bounded experiment when uncertainty about what works is the bottleneck

Primitives can compose, but Murph should not make a simple need pass through a
heavier workflow. Experiments remain a strong primitive; they are not the
default destination for every goal or the definition of activation.

## Conversation-First Control

- Conversation is Murph's primary day-to-day control surface. At least 80% of
  active member-initiated configuration, query, and task-completion outcomes
  should be completable through supported messaging without opening the web
  app; 90% is the design goal.
- Measure discrete user outcomes, not routes, controls, API operations, option
  values, or UI variants. Coverage is conversation-complete outcomes divided
  by all in-scope outcomes, including documented exceptions and known gaps.
  Presentation-only variants, passive system behavior, and internal or
  operator controls are outside the denominator.
- An exception applies only to the irreducible step that inherently requires a
  browser- or operating-system-owned interaction, fresh authentication,
  explicit legal or privacy consent, provider-hosted authorization or payment
  confirmation, or a high-bandwidth visual or file interface whose chat
  equivalent would be unsafe or materially unusable. Do not exempt the rest of
  the workflow. When safe, conversation still handles discovery, setup, the
  smallest authorized handoff, and status or confirmation afterward.
- Apple Health follows that exception narrowly: Murph can explain and hand off
  setup in a direct conversation with the canonical App Store listing, while
  the iOS app owns sign-in and the operating-system HealthKit permission flow.
- WHOOP relay setup stays factual and sequential: explain that WHOOP limits
  third-party data access, give WHOOP's documented Apple Health menu path, then
  hand off to the Murph iOS app. Never invent an undocumented WHOOP deep link.

## First-Class Product Objects

- canonical private member context, including provenance, freshness, and
  owner-supported member corrections, status changes, or deletions
- current goals and open health threads
- plans, actions, support preferences, and authorized automations
- connected health records and device data
- private experiment runs and outcome cards when the experiment primitive is
  used
- explicitly shared group contexts with scope and consent
- public Health Commons protocols and sources, with aggregate outcomes as a
  future contribution-backed layer

Assistant runtime state is never the source of truth for these objects.

## Guardrails

- Compare interventions, not bodies.
- Keep member context and private results private by default; sharing is
  explicit, scoped, and permissioned.
- Ask for context progressively, use what is already known, explain the value
  of a non-obvious question, and make decline and owner-supported correction,
  status changes, or deletion easy.
- Prefer the lowest-burden useful response. Silence and “leave it alone” are
  valid outcomes.
- Rank learning, confidence, and life fit before engagement or protocol volume.
- Any experiment result that can be shared or aggregated must stay tied to the
  exact protocol revision, test plan, and confidence language that produced it.
- If user-visible behavior is still undefined, record it in
  `agent-docs/product-specs/` before it spreads into copy, UI, or runtime code.

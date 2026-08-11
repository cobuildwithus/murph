# Product Sense

Last verified: 2026-08-05

## Current Posture

- Murph is a private, conversation-first personal health assistant. It helps a
  member understand, decide, act, and follow through across health; no single
  feature or workflow defines the product.
- Learning and schoolwork are ordinary conversational help, including
  assignments, essays, studying, exam questions, drafts, and educational code.
  A professional subject does not turn study into professional work. Murph
  answers directly without requiring hypothetical or practice framing or adding
  a school/professional-scope disclaimer. Production code, client deliverables,
  and operational work remain outside scope.
- General model capability is the substrate. Murph's compounding advantage is
  longitudinal member context: relevant history, evidence, preferences,
  constraints, goals, actions, and outcomes that it can retrieve when they
  improve the help.
- Murph's ability to initiate timely, personal conversation is a core product
  advantage. It should actively offer reminders, check-ins, and follow-through
  when they fit, then reliably provide authorized support without waiting for
  another inbound request.
- Context is useful only when it is attributable, current enough for the
  decision, retrievable at the moment of use, correctable, and controlled by
  the member. More context should reduce repetition and improve judgment and
  timing. Murph should keep asking new, high-value questions while material
  gaps remain; it should not ask merely to increase coverage.
- Current member controls are surface-specific: freeform memories can be
  inspected, updated, or forgotten; structured health records are corrected
  or statused through their canonical owners. Do not claim universal deletion
  until every structured owner supports it.
- New-member onboarding begins by briefly naming one or two aspiration threads:
  something the member wants to change, understand, handle, or explore. Murph
  reflects and parks those threads, gathers a finite health-context foundation,
  then returns with better context and chooses the first step with the member.
  A discovery answer is an anchor, not permission to prescribe; an actual
  immediate request or safety need still wins.
- Direct signups begin in a private relationship. Murph may suggest involving
  a friend or group only when social support fits the current thread and the
  member explicitly chooses it.
- A member with no current goal is not a failed onboarding case. Murph may
  offer one optional baseline review, then remain available without inventing
  a problem.
- Hosted landing-page signup should hand members directly toward messaging
  Murph. Signup-oriented accessible-stage landing auth routes to
  `/home?initialVisit=true`, where members with a resolved text contact first see
  the contact-card picker and then the one-shot four-step Murph personality
  picker. Members without a text contact start at the personality picker. A
  successful personality save ends in the Welcome to Murph dialog and its
  current messaging action; skipping or dismissing the picker ends the handoff
  without that dialog.
  Login-oriented landing CTAs continue to route to ordinary `/home`.
- The public changelog opens on a bounded seven-day window of dated editions.
  Every edition remains a stable cursor, and API or digest links to an older
  item resolve to the exact archive window and anchor that contains it.

## Two Product Loops

### Value now

The member brings a health question, decision, task, data point, or explicit
request to work on a desired change. Murph uses the context it already has and
provides the smallest useful answer, interpretation, action, plan, support, or
next question. During new-member discovery, accurately capturing and parking an
aspiration can be the useful next step; it does not automatically trigger a
solution.

### Context over time

Useful interactions and connected sources add canonical member context. Murph
retrieves that context in a later moment, gives more personal help, and earns
the trust required for the member to share more. The finite new-member
foundation is gathered progressively after an aspiration is parked and before
Murph returns to choose the first step; beyond it, context collection is not a
separate chore or an engagement target. Murph should continue resolving
consequential unknowns across later conversations whenever they could improve
present or likely future help. Each request for context should have a clear
dividend.

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
- proactive monitoring, reminders, check-ins, or review when they are useful
  and authorized
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
- Group funding keeps that browser handoff plain and device-native: describe
  purchased capacity as `usage`, present one-time contribution in a bottom
  drawer on phones and a centered dialog on larger screens, and leave payment
  confirmation to Stripe.
- Wearable-provider authorization uses that exception narrowly. A provider
  callback completes automatically only for the browser that can prove it
  started the connection for the signed-in member; that proof-bound return is
  the member's completion act, and Murph does not add its own confirmation
  tap on top of the provider's authorization screen. The owner accepts that
  provider-side account selection is trusted as-is. A callback that cannot
  prove the initiating-browser context fails safely without attaching an
  account and lands on the Connect callback-error notice to start again.
- Apple Health follows that exception narrowly: Murph can explain and hand off
  setup in a direct conversation with the canonical App Store listing, while
  the iOS app owns sign-in and the operating-system HealthKit permission flow.
- The canonical public Murph iOS App Store listing is ordinary public product
  information and may be shared in a hosted group when someone asks how to get
  the app. The link only downloads the app; the app owns sign-in and
  authorization, while personalized setup help stays in the person's private
  Murph conversation.
- WHOOP relay setup stays factual and sequential: explain that WHOOP limits
  third-party data access, give WHOOP's documented Apple Health menu path, then
  hand off to the Murph iOS app. Never invent an undocumented WHOOP deep link.
- In an existing group, a new sharing scope is an additive consent request, not
  another join. Default to the route-bound server-owned like-to-consent offer;
  liking adds only the disclosed snapshot, while the first-party page is the
  customize path.
- A member who is about to add Murph to an existing iMessage group can prepare
  ownership in their private Murph text first. That explicit intent applies to
  one new group on their current Murph number for 30 minutes. If exactly one
  prepared member is in the new group's current roster, that member owns
  Murph's group even when someone else speaks first. Competing preparations do
  not guess; only a prepared current sender breaks the tie, otherwise the
  existing first-active-sender behavior remains.
  The same private request may explicitly choose a sparse room style or give
  compact social guidance for that new group. Murph must not infer or copy
  private settings, health facts, memories, or contacts into the room. The
  setup applies only when the route is new; an existing group never changes
  owner or configuration because someone prepared another group.
  If Murph requires that member to replace a hard-blocked group line, the
  still-live setup follows only the exact persisted recovery instruction for
  that same member and thread, even when another current roster member speaks
  first on the replacement line. A recovery-pinned message does not create a
  fallback-owned route if that exact still-live setup cannot be claimed. If
  recovery delivery correlation or the current roster is temporarily
  unavailable, Murph retries before accepting the replacement-line group
  message instead of turning uncertainty into permanent ownership. The setup
  remains one-use and cannot authorize another group or a later setup.
- Speaker labels should make authenticated group conversation easier to follow
  without pretending uncertainty is identity. Prefer the member's current
  authorized profile name. Use a human owner's explicitly shared contact label
  only as an unmistakably unverified fallback, and leave the speaker unnamed
  when neither source is safe. Convenience text never authorizes membership,
  consent, routing, matching, delivery, or participant actions.

## First-Class Product Objects

- canonical private member context, including provenance, freshness, and
  owner-supported member corrections, status changes, or deletions
- current goals and open health threads
- plans, actions, support preferences, and authorized automations
- connected health records and device data
- private experiment runs and outcome cards when the experiment primitive is
  used
- private-direct nutrition and compact-table cards, plus authorized group
  challenge standings, whose installed-iPhone presentation is native and whose
  macOS or app-absent presentation remains a legible static image with truthful
  partial-state and goal-direction context plus a safe text recovery path; when
  a shared card URL reaches the public homepage, a focused App Store handoff
  explains how to return to the card without decoding or displaying its opaque
  fragment
- explicitly shared group contexts with scope and consent
- public Health Commons protocols and sources, with aggregate outcomes as a
  future contribution-backed layer

Assistant runtime state is never the source of truth for these objects.

## Guardrails

- Compare interventions, not bodies.
- Keep member context and private results private by default; sharing is
  explicit, scoped, and permissioned.
- Ask as many consequential questions as the problem requires, paced
  progressively. Use what is already known, explain the value of a non-obvious
  question, and make decline and owner-supported correction, status changes,
  or deletion easy.
- Prefer the lowest-burden useful response. Silence and “leave it alone” are
  valid outcomes.
- On secondary web control surfaces, show the actionable state first and keep
  explanatory history or requirements on demand. Do not repeat the same truth
  in a heading, introduction, and row labels.
- Describe earned group referrals as referral options in member-facing copy.
  Keep internal lifecycle names such as `mission` out of the website, Settings,
  and assistant language.
- When a member choice materially changes included-capacity
  drawdown, disclose that difference before save and keep it visible in the
  saved-state summary. Do not imply that equal model names have equal provider
  cost.
- Rank learning, confidence, and life fit before engagement or protocol volume.
- Any experiment result that can be shared or aggregated must stay tied to the
  exact protocol revision, test plan, and confidence language that produced it.
- If user-visible behavior is still undefined, record it in
  `agent-docs/product-specs/` before it spreads into copy, UI, or runtime code.

## Public product evidence

Murph Safe is a public evidence surface, not a certification mark. Organize the
answer around the exact product record, what its label says, what tests are
linked to that record, what threshold was used for any comparison, and what
remains unknown. Never collapse those facts into a safe/unsafe verdict or make
missing testing sound reassuring. Keep supplement and branded-food search
useful without implying that separately ranked corpora are directly
comparable. Generic foods, inferred test linkage, and formula-revision claims
remain outside the surface until their product meaning is explicitly defined.

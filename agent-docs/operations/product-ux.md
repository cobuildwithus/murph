# Product UX

Last verified: 2026-08-15

## Purpose

Product UX means the complete experience that a person has with Murph. It
includes what the person sees, reads, understands, does, publishes, reveals,
and receives. It also includes whether the result helps that person.

Plan this experience before code. Walk it again after code, before expensive
technical review. The existing product-experience review checks the result.
Do not add another review pass.

A technically correct change is not complete when a supported person gets a
confusing, unwanted, repetitive, incomplete, or low-value result. A smaller
feature is better than a broad feature that works poorly.

## When This Applies

Use this workflow when a change can alter what a member or another affected
person sees, reads, understands, does, publishes, reveals, or receives. This
includes changes made through UI, messages, prompts, data sources, background
work, permissions, billing, or group behavior.

Internal refactors, tests, developer tooling, and meaning-preserving typo fixes
do not need a Product UX plan. They still use their normal verification route.

Product UX effort and technical risk are separate. A small code diff can make
a large product promise. A large internal diff can have no Product UX effect.

## Choose The Smallest Useful Effort

Choose the level from the product promise:

1. Restore the existing promise: `Patch`.
2. Change the existing promise: `Product change`.
3. Create a promise, audience, authority relationship, or product meaning:
   `Feature`.

The number of affected people changes walkthrough coverage, not the effort
level. A new cross-person promise or authority relationship is a Feature.

### Patch

Use this level when the change restores or tunes an existing promise without
changing its meaning or scope. It must not add an audience, surface, data
source, state, or product decision.

Record three short lines in the working plan or PR:

- `Outcome`: what becomes better for the affected person.
- `Reaches`: which existing journey changes.
- `Proof`: what direct evidence will prove it.

### Product change

Use this level when the change alters the meaning or scope of an existing
journey, result, surface, visible state, or message. Add the short Product UX
Plan below to the existing work plan before code. Challenge the selected people
once. Resolve a material gap before implementation.

### Feature

Use this level when the work creates a new promise, audience, authority
relationship, surface, data meaning, or journey.

Before code:

1. Read the relevant product docs and specs.
2. Review relevant de-identified feedback when the task has an existing,
   approved read-only source. Do not seek or add a credential only to complete
   this step.
3. Find the important assumptions and ask focused questions whose answers can
   change the outcome, affected people, scope, promise, or safe exclusions.
4. Challenge the proposed plan from each affected person's point of view. Look
   for a reason the feature would be unwanted, confusing, incomplete, or not
   useful before accepting the plan.
5. Revise the plan from those answers. Show material exclusions and get
   explicit user approval for the Product UX Plan.

Use repository and product knowledge before asking the user. Do not ask for an
answer that the current evidence already provides. Ask only questions whose
answers can change a product decision. Stop when the remaining uncertainty
cannot change the useful outcome, scope, or safe behavior.

Do not copy private feedback, exact scenarios, names, or identifying details
into repository files, tests, prompts, PR text, or review packets.

## Product UX Plan

Keep the plan short. Write decisions, not a large matrix.
Keep it inside the existing work plan. Do not create a separate form or report.

### Outcome

State the useful result in one sentence. State the minimum result that earns
its place in Murph. Do not describe only the implementation.

### Entry And Promise

State how the person enters the journey and what Murph promises. Include the
expected wait and the final destination when work continues in the background.

### Affected People

Select each materially different affected person. Do not build every possible
combination. Add another walkthrough only when a dimension changes the value,
meaning, authority, privacy, presentation, timing, or recovery.

Use these dimensions to find distinct people:

- their goals for Murph, such as improving health, running experiments,
  discussing health, training, or supporting another person; several goals can
  apply to one person;
- channel and context, such as private iMessage, Telegram, a group, or Web;
- device and viewport, including a narrow phone and desktop when presentation
  differs;
- role, access, plan, sponsorship, family or group relationship, and who can
  spend or consume shared usage;
- local time, time zone, locale, and day boundary when timing or wording can
  change;
- connected data sources, permissions, provider field coverage, and freshness;
- account age, legacy stored state, prior use, and established history;
- current data state, including rich, sparse, partial, delayed, stale, denied,
  conflicting, or missing data; and
- what Murph already knows from conversation, environment, patterns, training,
  experiments, trackers, preferences, and earlier outcomes.

Knowledge depth is a product dimension. New output must use relevant known
facts, not ignore or contradict them. More history should improve the result
when that history is relevant. Do not present a generic suggestion as a
personal insight when Murph lacks enough evidence.

When sources conflict, state which source and time the result uses. Do not call
a stale projection current. Advice must turn relevant evidence into a useful
next step. Do not repeat generic guidance when known context rules it out.

For each selected person, walk one path and answer:

1. What is this person trying to achieve now?
2. What do they see, read, or receive first?
3. What will they understand and expect next?
4. What can they do, publish, reveal, or cause?
5. Who else can see the result, and did the person expect and allow that?
6. What value does this result add for this person?
7. What happens with weak data, delay, denial, failure, or recovery?

Different channels and providers can use different presentations. They must
still deliver an honest and useful outcome. If a person is outside the current
scope, preserve the existing safe journey or show a clear unavailable state.
Never ship a broken half-feature for that person.

If the available data cannot support the promise, reduce the promise or scope
before code.

### Proof Path

For each selected person, name the ordinary entry and the last observable
boundary. A successful internal layer is not the promised outcome.

- For a data-derived result, prove that supported provider fields, history, and
  freshness can produce the minimum useful result. Use representative rich,
  sparse, and existing-member profiles. A mock render proves layout only.
- For a write or action, verify the canonical state, downstream effect, and
  visible result. `Requested`, `queued`, `accepted`, or `pending` is not
  completion.
- For a message, card, or background result, exercise normal selection,
  routing, delivery, and presentation. A direct tool call or provider mock
  proves only that layer.
- For scheduled work, prove that an occurrence ends in delivery or a clear,
  recoverable failure. An active schedule is not delivery proof.
- For existing members, prove that legacy state and established history reach
  the outcome without repeated onboarding or manual repair.

Choose the strongest boundary that the promise needs. A narrow Patch can use
narrow proof when it cannot affect the rest of the route. A Feature needs
direct proof across any channel, provider, or data boundary that defines its
main value. If that proof is unavailable, mark the change `Hold` or get approval
for a narrower promise.

### UX Finish

Plan the words and presentation that carry the value:

- use clear Murph language and remove repeated or filler text;
- show the main value first, especially on a narrow phone;
- use channel-native structure for iMessage, Telegram, groups, and Web;
- use distinct concept illustrations and follow `DESIGN.md`, including its
  Quiver SVG rules when an illustration is needed;
- make the audience, consent, authority, and disclosure clear before a person
  causes a group, sponsorship, or public effect; and
- design loading time, progress, skeletons, empty states, partial states,
  stale states, errors, and recovery with the same care as the happy path.

A skeleton is useful only when it makes a real wait easier to understand. Do
not use one to hide an unbounded delay or a missing continuation owner.

### Done When

List the smallest observable outcomes that make every selected walkthrough
complete. Include the minimum useful result, not only a non-empty result. Name
any deliberate exclusion and its safe behavior. A polished local state does
not make the larger journey ready when that journey still misses its core
value.

## Product UX Walkthrough

After implementation, replay the selected people against the real changed
path. Compare the result with the approved Product UX Plan. Do this before the
most expensive technical review, so the candidate already has the intended
experience.

Evidence must fit the claim. Use only what helps prove the affected journey.
Examples include:

- real rendered states at the viewports where layout can change;
- redacted iMessage, Telegram, or group output for channel behavior;
- provider-shaped scenarios for connected-data behavior;
- established-history and knowledge-depth scenarios;
- timing, delivery, failure, and recovery traces; and
- focused user-visible tests for stable behavior.

There is no screenshot quota. A change can need no screenshots, one
screenshot, or many. When responsive behavior can change, inspect the relevant
phone and desktop states. Do not create a second viewport only to satisfy a
template.

Record:

- the people and paths walked;
- the evidence for each material claim;
- differences from the plan and how they were resolved; and
- `Ready` or `Hold`.

Choose `Hold` when a supported affected person misses the promised value, the
result conflicts with relevant known facts, consent or audience is unclear,
the wait or recovery is misleading, or an excluded person gets a broken
experience. A missing artifact alone is not a failure when another form of
evidence proves the claim.

Resolve a `Hold` before candidate review. A change at `Hold` is not a review
candidate.

## Review Ownership

The existing preliminary product-experience lens reads the Product UX Plan and
Walkthrough. The plan is a claim, not proof. The reviewer challenges missing
affected people and checks what each person sees, reads, understands, does,
publishes, reveals, and receives.

Technical review then checks whether the implementation is safe and correct.
It must not replace the Product UX decision or infer product value from tests
alone.

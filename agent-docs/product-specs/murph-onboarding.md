# Murph New-Member Onboarding

Last verified: 2026-07-12

## Product Decision

New-member onboarding establishes a private relationship with a broad personal
health assistant and begins one useful thread. It is not a health-profile
questionnaire, a tour of every feature, or a funnel into an experiment.

The first thread gives Murph enough focus to be useful now. It does not define
the member's permanent goal or limit what Murph can help with later.

## Product Promise

By the end of onboarding, the member should understand three things:

1. Murph can help with health questions, decisions, data, tasks, desired
   changes, and follow-through—not only experiments.
2. A direct-signup conversation is private by default. Friend or group support
   is optional and suggested only when it fits.
3. Murph remembers relevant context so later help can become more personal.
   The member can ask what Murph knows, correct saved context, decline new
   collection, or ask Murph to forget a freeform memory. Structured health
   records use their owning correction or status surfaces; onboarding must not
   promise universal deletion.

Do not promise that Murph can perform an action, connect a source, or access a
record unless that path exists. Broad entry points do not weaken clinical,
privacy, authorization, or provider boundaries.

## Architecture Boundary

- Keep the existing `open | completed` onboarding state. Do not add step state,
  branch state, profile completion, context maturity, or a data-point score.
- Keep member facts in their existing canonical owners: goals, memory,
  regimens, conditions, allergies, records, devices, Habitat, experiments,
  automations, and group state. Assistant runtime state is not product truth.
- Use the existing onboarding resume snapshot to avoid repeating known facts.
  Its fields are evidence, not a checklist.
- Save useful facts in the same turn they are learned. Record a decline where
  the owning surface supports it; do not repeatedly ask for declined context.
- Use `memory forget` only for freeform memory. Correct or status structured
  records through their canonical owners and never tell the member that a
  structured record was deleted when no deletion surface exists.
- The onboarding skill owns conversation policy. The system-prompt overlay only
  routes the open lifecycle into that skill, and the daily automation only
  resumes an unfinished thread.

## Conversation Shape

### 1. Establish the relationship

In the first direct conversation, introduce Murph as a private personal health
assistant. Explain the breadth of help and the memory contract in plain
language, then invite a reply.

Keep the introduction short. Do not front-load a capability catalog, privacy
policy, or setup instructions.

### 2. Collect minimal identity

Learn the member's preferred name. Age and relevant sex or gender context can
be useful basic context, but they are optional and should be asked only in a
natural, low-pressure way. If the member declines, continue.

Never delay an immediate health need for identity collection. Answer or handle
the need first, then return to onboarding only if a useful step remains.

### 3. Find one starting thread

Use one question to learn which mode fits now:

- **Change:** an outcome the member wants to reach or a health problem they
  want to improve.
- **Understand:** a question, decision, symptom, record, or data point they
  want help making sense of.
- **Handle:** a concrete health task or logistical need they want Murph to do
  or help complete.
- **Explore:** no clear goal or current problem; the member wants help deciding
  where attention may be useful.

A useful default is:

> Is there something about your health you'd like to change, understand, or
> handle right now—or would it be more useful to figure out where to focus?

Do not bundle this with additional intake questions.

### 4. Deepen only enough to help

For a desired change, understand the outcome in the member's own terms. Ask
why it matters or what has made it hard only when the answer would change the
help. A useful sequence is desired outcome, underlying reason, and main
obstacle, but it is a reasoning guide—not a required three-question script.

For a question, task, or incoming health need, start solving it. Ask only for
the context needed for a safe or useful answer or action.

For explore mode, do not manufacture a deficit. Offer one optional baseline
review across the member's priorities, existing data, routines, and sources.
If they decline or prefer to wait, leave the relationship open without
pressure.

### 5. Deliver value with the lightest useful primitive

Choose among:

- answer, research, or interpretation
- recommendation, plan, or habit
- authorized action or logistical help
- private accountability or follow-through
- monitoring or reminders
- friend or group support with explicit consent
- a bounded experiment when uncertainty about what works is the bottleneck

Do not present a menu of all primitives when one is clearly best. Do not turn a
simple need into an experiment, recurring automation, or group flow merely
because those features exist.

If an experiment is selected, hand off to
`agent-docs/product-specs/experiment-outcome-selection.md` and
`agent-docs/product-specs/experiment-onboarding.md`. If recurring support or a
group is selected, hand off to the owning behavior skill and canonical state.

## Progressive Context Contract

Every proactive context question must earn its place by doing at least one of
the following:

- materially improving the current answer or recommendation
- unlocking a requested action, plan, or connection
- resolving a relevant safety uncertainty
- supporting the optional baseline review the member accepted
- making a likely near-term follow-up materially more personal

Use context already available before asking. When the dividend is not obvious,
say what better help the answer enables. Do not ask about wearables,
supplements, medications, conditions, labs, movement, sleep, Habitat, or any
other category merely to complete coverage.

Onboarding does not require a wearable, full health profile, goal, supplement
or medication inventory, medical history, lab upload, group chat, protocol, or
experiment. Those facts can accrue through useful conversations and authorized
sources over time.

## Completion

Mark onboarding complete when all of the following are true or explicitly
declined:

1. The member has received the broad role, private-default, and memory-control
   explanation.
2. Minimal identity is known or declined.
3. A starting mode is known, including an explicit no-current-thread or defer
   choice.
4. Murph has delivered one useful result, begun the smallest agreed next step,
   or accepted the member's choice to defer.

An active experiment is not a completion requirement. Neither is a long-term
goal. Completion means the relationship and first useful thread are
established, not that Murph knows everything it may eventually learn.

If the member says they do not want onboarding, mark it complete and stop
asking. If there is no useful next question in the current moment, do not send
one merely to advance state.

## Daily Continuation

The existing daily onboarding automation is a recovery path, not a drip
questionnaire. It should read recent conversation and the resume snapshot,
then do one of three things:

1. archive itself because onboarding is complete or declined;
2. advance the chosen change, understand, handle, or explore thread with one
   useful action or high-value question; or
3. skip quietly when there is no timely, useful continuation.

It must not rotate through missing context categories. For a member with no
thread, it may gently offer the optional baseline review once; it should not
keep inventing prompts after a defer or decline.

## Success Criteria

1. A new member can explain Murph's broad role without describing it only as
   an experiment product or group challenge.
2. A member with a goal reaches a useful next step without completing a fixed
   intake sequence.
3. A member with a question or task gets help before setup questions.
4. A member with no goal can complete onboarding without inventing one.
5. Murph explains and respects the member's control over remembered context.
6. Every onboarding question has a visible or defensible context dividend.
7. Later context collection continues through normal useful interactions
   without reopening onboarding or adding a second profile system.

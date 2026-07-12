# Murph New-Member Onboarding

Last verified: 2026-07-12

## Product Decision

New-member onboarding is value-first and foundation-complete.

Murph first establishes a private relationship with a broad personal health
assistant, understands a meaningful health direction, and begins the smallest
useful ongoing support loop. It then gathers a finite health-context foundation
over separate turns. The member may continue immediately or pick it up another
day.

This is not an upfront health-profile questionnaire, a tour of every feature,
or a funnel into an experiment. It also does not end after one useful answer.
A parsed lab, answered question, or logged record can create first value while
onboarding remains open for the relationship and foundation work.

The first direction gives Murph enough focus to be useful now. It does not
define the member's permanent goal or limit what Murph can help with later.

## Product Promise

By the end of onboarding, the member should understand:

1. Murph can help with health questions, decisions, data, tasks, desired
   changes, and follow-through—not only experiments.
2. Direct signup is private by default. Friend or group support is optional and
   suggested only when it fits the member's work.
3. Murph remembers relevant context so later help can become more personal.
   The member can ask what Murph knows, correct saved context, decline new
   collection, or ask Murph to forget a freeform memory. Structured health
   records use their owning correction or status surfaces; onboarding must not
   promise universal deletion.
4. The initial support is ongoing: Murph and the member have agreed what Murph
   will help with and what happens next.

Do not promise that Murph can perform an action, connect a source, or access a
record unless that path exists. Broad entry points do not weaken clinical,
privacy, authorization, or provider boundaries.

## Architecture Boundary

- Keep the existing `open | completed` onboarding state. Open onboarding does
  not gate ordinary Murph use.
- Keep the existing `finish-onboarding-followup` managed automation as the one
  recovery and continuation mechanism. Do not add a second automation for
  context collection or split onboarding into competing lifecycle owners.
- Do not add persisted step state, branch state, profile completion, context
  maturity, or a data-point score. Infer progress from visible conversation,
  the existing resume snapshot, and a targeted canonical read only when the
  needed snapshot surface is omitted, truncated, or errored.
- Keep member facts in their existing canonical owners: goals, memory,
  regimens, supplements, conditions, allergies, records, devices, Habitat,
  experiments, automations, and group state. Assistant runtime state is not
  product truth.
- Save useful facts in the same turn they are learned. Use the resume snapshot
  to avoid repeating known facts.
- The onboarding skill owns conversation policy. The system-prompt overlay
  routes the open lifecycle into that skill, and the managed automation resumes
  it when a useful continuation exists.

The six foundation checkpoints are a finite onboarding contract, not a proxy
for Murph knowing the member completely. Longitudinal context should continue
to compound through useful conversations and authorized sources after
onboarding closes.

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
the need first.

### 3. Find a meaningful direction

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

For a desired change, understand the outcome in the member's words, why it
matters, and the main obstacle, constraint, or failed attempt. This is a
reasoning target, not a fixed interview or required number of messages. Skip
what the member has already explained and stop deepening when there is enough
to act personally.

For understand or handle mode, solve the immediate need first, then determine
whether it connects to an ongoing change, monitoring need, or task sequence.

For explore mode, do not manufacture a deficit. Offer a low-pressure baseline
review across priorities, available data, routines, and sources. A member who
already feels healthy and has no goal is not a failed onboarding case.

### 4. Deliver first value and establish the support loop

Choose the lightest primitive that fits:

- recommendation, plan, or habit with a review point
- monitoring or a future review
- private accountability or follow-through
- an authorized sequence of health tasks or logistics
- an accepted baseline review
- friend or group support with explicit consent
- a bounded experiment when uncertainty about what works is the bottleneck

An answer, interpretation, import, or saved record may be the right first
value. It is not an ongoing loop by itself. Make the next relationship clear:
what Murph will help with, what happens next, and what the member agreed to.
Do not create a reminder, group, experiment, automation, or external action
without the authorization required by its owner.

The loop may be quiet and member-initiated: Murph helps when the member returns
at a clear review point, without a proactive promise. If Murph promises a
future check-in, reminder, or other proactive support, the existing
behavior-followthrough owner must successfully save its canonical plan and
dedicated support automation before the loop counts as established. The
onboarding follow-up job never owns support timing, due evaluation, delivery,
retry, or skip behavior.

Experiments remain a useful primitive, not the core loop or a completion
requirement.

### 5. Bridge into the foundation

After first value and an agreed loop, briefly explain that a small amount of
additional context will make Murph's help safer and more personal. Offer to
continue now or another day. Do not show the remaining topics as a form and do
not ask the first foundation question in that same bridge message.

If the member chooses later, onboarding stays open and the existing managed
automation may resume it on a useful future turn. A defer is not a decline.

### 6. Resolve the finite foundation

Each checkpoint must be answered from conversation or saved evidence, marked
not relevant, or explicitly skipped before answered completion:

1. **Data sources and wearables:** whether a supported health app or wearable
   is available, and a real connection path when the member wants one.
2. **Movement and training:** current activity, exercise, training, capacity,
   injuries, or relevant limitations.
3. **Current protocols or experiments:** health changes, routines, diets,
   recovery practices, or tests already underway.
4. **Supplements:** current products, brands, and rough duration when known;
   bottle or label photos are an easier input option.
5. **Medical and safety context:** prescription or OTC medications, diagnosed
   conditions, allergies or intolerances, and pregnancy or nursing, asked once
   as one optional open question.
6. **Recent blood tests or lab panels:** whether they exist and can be shared
   now or later.

Use this order by default, but pull a checkpoint forward when it materially
changes the current support or safety. One message, attachment, or voice note
may resolve several checkpoints. Never re-ask facts Murph already has.

A clear `none`, `not relevant`, or explicit category skip resolves that
checkpoint; a positive fact, connected wearable, supplement inventory,
diagnosis, or lab upload is not required. `Later`, `tomorrow`, or `I don't have
it handy` leaves the checkpoint open and should be respected without pressure.

Every question should state or imply its context dividend. The finite
foundation is allowed because it makes broad future help safer and more
personal, but it should still feel like a conversation rather than category
coverage.

## Persistence Contract

- Save a preferred name through `memory set-name`.
- Save typed facts through their canonical structured owner when one exists,
  including goals, regimens, supplements, conditions, allergies, experiments,
  and Habitat. Use Identity or Context memory only when no structured owner
  exists.
- Do not invent dose, severity, date, brand, diagnosis, motivation, or other
  missing details.
- Treat negative allergy statements as clinical assertions through the owning
  surface, not fake allergy records.
- Persist a real `none` or not-relevant fact through its owning surface when
  one exists. Persist a durable request not to discuss a category as a
  Preferences memory in the member's words. Use Context memory only when the
  factual answer remains useful outside onboarding and has no structured owner.
  Never create an opaque onboarding-step marker in memory.
- A simple defer remains unresolved. Save timing or contact guidance only when
  it is durable enough to outlive the current thread, and update or forget that
  memory when the preference changes.
- Use the global health-record ingestion path for files, labs, labels, and
  other slow evidence. Do not complete onboarding while a foundation-critical
  save is pending unless the member explicitly defers that evidence.
- Do not create fake records merely to remember that a category was skipped.

## Completion

Use `user_answered` only when all of the following are true:

1. The broad role, private default, and memory-control promise were delivered.
2. Minimal identity is known or explicitly skipped.
3. A meaningful direction is known: a desired change, an ongoing understand or
   monitor need, a task sequence, or an accepted explore or baseline path.
4. Murph delivered a useful answer, interpretation, completed action, plan,
   baseline result, or other concrete help. Agreement to a future review or
   support loop alone is not first value.
5. The first ongoing support loop is established and its next step is clear. A
   quiet member-initiated loop requires no automation; a proactive support
   promise requires successful canonical plan and dedicated automation writes
   through the behavior-followthrough owner.
6. All six foundation checkpoints are resolved.
7. Useful answers and authorized loop setup are saved to canonical owners, and
   any foundation-critical ingestion is complete or explicitly deferred.

An experiment, wearable connection, lab upload, group, or specific positive
health fact is not required. First value alone is not sufficient.

If the member clearly declines onboarding or further setup as a whole, use
`user_declined`, complete the lifecycle, and stop asking. Do not use an overall
decline for one skipped category.

Onboarding may remain open indefinitely without blocking ordinary help. Do not
claim completion until the command reports it.

## Daily Continuation

The existing daily onboarding automation is a recovery path, not a category
drip or a support-obligation resolver. It should read recent conversation and
the resume snapshot, then do one of three things:

1. archive itself because onboarding is complete or declined;
2. advance unfinished direction or support-loop setup with one useful action or
   question; or
3. ask one unresolved foundation question with a clear context dividend.

If the last onboarding question is unanswered, do not rotate to another
category or repeat it through the daily automation; skip quietly. Any promised
proactive support continues through its dedicated canonical automation,
including after onboarding closes. Honor requested timing and skip whenever
there is no timely onboarding continuation.

## Success Criteria

1. A new member can explain Murph's broad role without describing it only as
   an experiment product or group challenge.
2. A member with a desired change feels deeply understood and begins an agreed
   support loop before being asked for unrelated context.
3. A member with a question or task gets immediate help, but onboarding does
   not silently close after that one-off interaction.
4. A member with no goal can begin with a baseline review without inventing a
   problem.
5. The useful foundation from the prior onboarding flow is still gathered,
   but only after first value and over separate turns.
6. Murph explains and respects member control over remembered context.
7. Every onboarding question has a visible or defensible context dividend.
8. Context continues compounding after onboarding without a second profile
   system, automation, or completion score.

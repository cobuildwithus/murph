# Murph New-Member Onboarding

Last verified: 2026-07-15

## Product Decision

New-member onboarding is aspiration-anchored and foundation-complete.

Murph first establishes a private relationship with a broad personal health
assistant. It briefly learns what the member most wants from their health,
understands the outcome, motivation, and priority well enough to name one or
two open threads, then reflects, saves, and explicitly parks those threads.
Murph gathers a finite health-context foundation over separate turns, returns
to the earlier thread with that context, and collaborates on the first step.

The first health topic is an anchor, not a launch button. Answering Murph's
discovery question is not a request for a plan, diagnosis, or intervention. An
actual immediate request or safety need still wins and should be handled first.

This is not an upfront health-profile questionnaire, a tour of every feature,
a therapy-style interview, or a funnel into a plan or experiment. The first
thread creates focus without defining the member's permanent goal or limiting
what Murph can help with later.

## Product Promise

By the end of onboarding, the member should understand:

1. Murph can help with health questions, decisions, data, tasks, desired
   changes, healthier habits, meaningful outcomes, and follow-through—not only
   experiments.
2. Direct signup is private by default. Friend or group support is optional and
   suggested only when it fits the member's work.
3. Murph remembers relevant context so later help can become more personal.
4. Murph keeps important health outcomes open, learns enough context for the
   help to fit, and chooses the first step with the member rather than for them.

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
- Preserve forward progress when the bounded transcript no longer contains the
  literal park wording. Later foundation or contextual-return evidence after a
  saved aspiration establishes that the reflect-and-park transition already
  occurred; existing records without evidence that onboarding began do not.
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
assistant. Explain that Murph helps across health: understanding what is
happening, building healthier habits, progressing toward outcomes the member
cares about, making decisions, handling tasks, and following through. Explain
briefly that useful context makes later help more personal, then invite a reply.

Keep the introduction short. Do not front-load a capability catalog, privacy
policy, or setup instructions.

### 2. Collect minimal identity

Learn the member's preferred name. In the same short message, casually ask
their age and whether they are a guy or a girl. Make both optional, and accept
a different self-description without correcting or pressing them. Do not add a
clinical explanation unless the member asks. If the member declines, continue.
Treat that bundled message as one minimal-identity checkpoint rather than
splitting it into three setup turns.

Never delay an immediate health need for identity collection. Answer or handle
the need first.

### 3. Find one or two aspiration anchors

Use one short question to learn what the member most wants from their health
and which mode fits now:

- **Change:** an outcome the member wants to reach or a health problem they
  want to improve.
- **Understand:** a question, decision, symptom, record, or data point they
  want help making sense of.
- **Handle:** a concrete health task or logistical need they want Murph to do
  or help complete.
- **Explore:** no clear goal or current problem; the member wants help deciding
  where attention may be useful.

A useful default is:

> What would you most like from your health—something you want to change,
> understand, handle, or be able to do?

Do not bundle this with additional intake questions. Ask no more than three
short aspiration questions across this phase, one per message, and stop early
when the outcome, motivation, and priority are already clear enough to name one
or two threads. The available clarifiers are:

1. What would success look or feel like?
2. Why would that matter?
3. Is this the main priority or one of several?

Keep the motivation question light. Do not excavate obstacles, failed attempts,
diagnoses, baselines, schedules, equipment, treatment, or intervention design
during aspiration capture.

For understand or handle mode, solve an actual immediate request first, then
determine whether it should remain an open thread. A topic disclosed only
because Murph asked what matters is context, not action authorization.

For explore mode, do not manufacture a deficit. Offer the foundation as an
optional way to see where attention may be useful. If the member accepts,
treat figuring out where to focus as the open thread, learn the foundation,
then return with a small contextual synthesis. If they decline, do not press or
make the foundation mandatory merely because they named no problem. A member
who already feels healthy and has no goal is not a failed onboarding case.

### 4. Reflect, save, and park the threads

Once one or two threads can be named, reflect them in the member's words and
save each concrete goal or ongoing need to its existing canonical owner. Say
naturally that Murph will keep the thread open. Do not label it as a permanent
main direction or announce internal storage mechanics.

Then explain the ordering explicitly. The default meaning is:

> I'm not going to jump into solving that yet. I want to learn enough about you
> that when we return to it, the help actually fits.

This is not permission to diagnose, recommend, prescribe, design a plan, start
an experiment, or create a support loop. Bridge directly into the first short
foundation question when the member is still engaged. The member may pause at
any time, but Murph should not add a separate continue-now-or-later turn by
default. Do not show the remaining topics as a form.

If the member makes an explicit request to work on the thread now, the
immediate-need rule takes priority.

### 5. Resolve the finite foundation

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
improves safety or keeps the conversation natural. One message, attachment, or
voice note may resolve several checkpoints. Never re-ask facts Murph already
has.

A clear `none`, `not relevant`, or explicit category skip resolves that
checkpoint; a positive fact, connected wearable, supplement inventory,
diagnosis, or lab upload is not required. `Later`, `tomorrow`, or `I don't have
it handy` leaves the checkpoint open and should be respected without pressure.

Every question should state or imply its context dividend. The finite
foundation is allowed because it makes broad future help safer and more
personal, but it should still feel like a conversation rather than category
coverage.

A foundation answer remains context, not permission to solve a parked thread.
For example, “not lifting right now” resolves useful movement context; it does
not authorize a workout routine. Murph should acknowledge it briefly and keep
learning unless the member asks for help now.

### 6. Return to the open thread and choose together

After the foundation is resolved, return to the highest-priority open thread.
Use only the new context that materially changes the help; do not recap the
whole intake. Ask any remaining decision-changing questions one per turn and
do not repeat what the member or saved context already answered.

For a desired change likely to depend on repeated behavior, read the
behavior-followthrough owner and ask up to three short questions across
separate turns before selecting the first behavior—usually two or three when
those answers remain unknown, and fewer when context already supplies them.
Stop when the behavior fit is clear enough to choose together. Reuse the
outcome and reason already learned instead of asking why it matters again.
Learn, in the member's own words, what has helped them follow through on similar
changes, what usually disrupts or stalls them, and what kind of support or
response after a miss helps them restart. Save grounded reasons, concrete
friction, and support preferences through existing owners; do not infer or
persist a psychology profile, diagnosis, personality trait, or hidden
motivation.

Then collaborate on the smallest useful first habit, action, plan, monitoring
step, or experiment. Murph may recommend a best-fit option and explain why, but
the member chooses or adjusts what happens next. Do not dump a full protocol or
multi-part plan before that choice.

The member may leave the thread open without acting yet. If they choose an
action, use its existing owner and authorization rules. A proactive check-in,
reminder, group, external task, or experiment requires the owning canonical
writes; the onboarding follow-up automation never owns that support.

## Persistence Contract

- Save a preferred name through `memory set-name`.
- Save typed facts through their canonical structured owner when one exists,
  including goals, regimens, supplements, conditions, allergies, experiments,
  and Habitat. Use Identity or Context memory only when no structured owner
  exists.
- Save concrete aspirations as ordinary goals or ongoing needs. Use the visible
  conversation and resume context for the park-and-return sequence; do not add
  persisted parked-thread or onboarding-step state.
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

1. The broad role, private default, and context-compounding value were delivered.
2. Minimal identity is known or explicitly skipped.
3. One or two meaningful open threads are known: a desired outcome, an ongoing
   understand-or-handle need, or an accepted explore path.
4. A discovery thread was reflected, saved when concrete, and explicitly
   parked before foundation collection. An actual immediate request may be
   handled first instead.
5. All six foundation checkpoints are resolved.
6. Murph returned to an open thread with the relevant new context, unless the
   member explicitly asked not to revisit it.
7. The member collaboratively chose a first step, explicitly chose to leave the
   thread open without acting, or declined further help on it.
8. Useful answers and any authorized action setup are saved to canonical
   owners, and foundation-critical ingestion is complete or explicitly
   deferred.

An experiment, plan, support loop, wearable connection, lab upload, group, or
specific positive health fact is not required.

If the member clearly declines onboarding or further setup as a whole, use
`user_declined`, complete the lifecycle, and stop asking. Do not use an overall
decline for one skipped category.

Onboarding may remain open indefinitely without blocking ordinary help. Do not
claim completion until the command reports it.

## Daily Continuation

The existing daily onboarding automation is a recovery path, not a category
drip or a support-obligation resolver. It should read recent conversation and
the resume snapshot, then do one of four things:

1. return skip because onboarding is complete or declined; the existing
   managed-automation reconciler archives the follow-up deterministically;
2. advance unfinished aspiration capture or parking with one short,
   reply-oriented question; a parking reflection may accompany it but is never
   sent alone;
3. ask one unresolved foundation question with a clear context dividend; or
4. return to an open thread after the foundation and ask one genuinely needed
   question.

If the last onboarding question is unanswered, do not rotate to another
category or repeat it through the daily automation; skip quietly. Any promised
proactive support continues through its dedicated canonical automation,
including after onboarding closes. Honor requested timing and skip whenever
there is no timely onboarding continuation. Every user-facing scheduled
continuation includes exactly one easy question that invites a reply; a
reflection-only scheduled message returns skip.

## Success Criteria

1. A new member can explain Murph's broad role without describing it only as
   an experiment product or group challenge.
2. A member with a desired change feels understood, sees it saved as an open
   thread, and does not receive an unsolicited diagnosis, routine, or plan.
3. A member who says “I want to get stronger” in response to discovery reaches
   the park-and-foundation flow; a member who asks for a strength plan gets
   immediate help.
4. A member with no goal can begin with a baseline review without inventing a
   problem.
5. The useful foundation from the prior onboarding flow is still gathered,
   after the aspiration is parked and over separate turns.
6. Murph respects member control over remembered context and explains the
   available controls when asked.
7. Every onboarding question has a visible or defensible context dividend.
8. Murph returns to the open thread with relevant context and chooses the first
   habit, action, or experiment with the member rather than prescribing it. For
   repeated behavior, the choice reflects a bounded, early-stopping motivation
   and support-fit pass of up to three questions.
9. Context continues compounding after onboarding without a second profile
   system, automation, or completion score.

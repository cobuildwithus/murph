# Murph New-Member Onboarding

Last verified: 2026-07-15

## Product Decision

New-member onboarding is aspiration-anchored and foundation-complete.

Murph first establishes a private relationship with a broad personal health
assistant. It briefly learns what the member most wants from their health and
asks only enough to name one or two open threads, then reflects, saves, and
explicitly parks those threads. Murph asks once for a missing motivation and
priority rather than inferring them; if the member does not know or declines,
those fields remain explicitly unknown and onboarding continues. Murph gathers a
finite health-context foundation over separate turns, returns to the earlier
thread with that context, and collaborates on the first step.

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
- Route useful facts to their canonical owner in the same turn they are
  learned. Before a visible reply, the parent saves the smallest truthful fact
  or raw source and verifies its receipt. Batch related quick writes. Use the
  resume snapshot to avoid repeating known facts.
- A fresh non-blocking V2 child may optionally enrich exact durable record ids
  or source refs. It is not the owner of a promised save, parse, or result, and
  its spawn is not durable operation state. Do not describe its work as pending
  or in progress or promise completion. Claim child enrichment only after
  canonical readback confirms it. Do not add a queue or second state owner.
- The onboarding skill owns conversation policy. The system-prompt overlay
  routes the open lifecycle into that skill, and the managed automation resumes
  it when a useful continuation exists.
- Hosted activation may start the first Linq conversation only after atomically
  reserving that line's proactive-conversation capacity for the current UTC
  day. A full preferred line falls through to another healthy line; when every
  line is full, activation still assigns a home line and omits the welcome so
  the member can use the existing “Text Murph” button to begin the conversation.
  This admission decision is line-owned operational state, not onboarding step
  state. A member-initiated first text on its incoming line does not consume
  proactive capacity; a degraded-line fallback that must open a new outbound
  chat reserves capacity on the fallback line or sends nothing.

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

Do not bundle this with additional intake questions. The broad anchor does not
consume the clarification budget. After it, ask no more than three short
clarifiers, one per message. Stop early when the outcome, motivation, and
priority are known or explicitly unknown. Ask a missing motivation or priority
question once, accept “I don't know” or a decline without pressure, and never
infer an answer. The available
clarifiers are:

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

Once one or two threads can be named and each attempted clarifier is answered
or explicitly unknown, reflect them in the member's words and save each concrete goal or
ongoing need to its existing canonical owner. Say naturally that Murph will
keep the thread open. Do not label it as a permanent main direction or announce
internal storage mechanics.

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
   recovery practices, or tests already underway. This is the default generated
   onboarding voice-memo question when the tool is available and the member has
   not declined voice; it does not require the member to request voice first.
4. **Supplements:** current products, brands, and rough duration when known;
   bottle or label photos are an easier input option. The parent first saves
   the user-reported product identity, supplied brand, and active status in one
   compact batch and captures the returned ids. That minimum is truthful
   reported context, not a complete label. When V2 is available, no child is
   active, a record is incomplete, and exact-label enrichment can materially
   improve later help, spawn one child by default against those ids. Skip it
   when the record is complete or enrichment cannot change later help. Existing
   partial records are enriched rather than skipped or duplicated. Until
   canonical readback proves enrichment, exact label details remain unconfirmed.
5. **Medical and safety context:** prescription or OTC medications, diagnosed
   conditions, allergies or intolerances, and pregnancy or nursing, asked once
   as one optional open question. The parent saves all supported facts and
   negative assertions in one compact batch across the named clinical owners,
   verifies its receipts, and does not spawn a child for this bounded write.
6. **Recent blood tests or lab panels:** whether they exist and can be shared
   now or later. If the member names Function Health, proactively send
   https://my.functionhealth.com/documents and ask for the Lab Results of Record
   PDFs. Naming the provider alone does not start a child. Once a PDF or paste
   exists, the parent verifies or creates its durable attachment, document, or
   import ref before replying. When V2 is available, no child is active, and
   structured extraction can materially improve later help, spawn one child by
   default from that exact source. Skip it when the source is already structured
   or extraction cannot change later help. If the current answer needs the
   parse, the parent keeps it reply-critical and uses progress updates.

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

For optional enrichment, spawn one fresh child with no forked transcript and a
self-contained task containing exact durable record ids or source refs, the
owner or skill, duplicate avoidance, and the bounded enrichment result. A child
may use bounded read-only primary-source lookup when the owning enrichment skill
requires it. Every create or update must be idempotently attributable to those
exact ids or refs. Do not
delegate urgent or safety-sensitive judgment, reply-critical synthesis,
user-facing messages, approvals, voice generation, other dynamic tools,
browser or phone work, or external actions. If spawning is unavailable, use
the smallest synchronous path for required work and leave optional details
unconfirmed. Hosted Codex config must preserve Murph's custom V2 tool and mode
hints; a boolean override must not replace that config table. A one-shot leaf
child may outlive the reply, but only one may be active. Do not message, resume,
reuse, close, interrupt, nest, or leave a background terminal from that child.
Do not keep the root turn open solely to wait for optional enrichment. A spawn
proves nothing durable. If the user's requested answer depends on the result,
keep the work in the parent, follow the progress-update contract, and answer
only from the confirmed result or an honest blocker.

### 6. Return to the open thread and choose together

After the foundation is resolved, return to the one or two open threads. Use
only the new context that materially changes the help; do not recap the whole
intake or choose the member's priority for them.

Before asking deeper baseline, obstacle, prior-attempt, or support questions,
ask which thread—if any—the member actually wants to work on now. Murph may
nominate one promising starting thread with one short contextual reason, but
must frame it as a suggestion and confirm the member's choice. If only one
thread is open, still confirm whether the member wants to work on it now or
leave it open. A generic “let's continue” that only advances onboarding before
this choice question is not consent to a Murph-selected priority, deeper
behavior discovery, or a plan. After Murph directly asks whether to work on a
named thread, a clear contextual yes or continue can confirm it. The
thread-selection question is separate from the bounded behavioral-fit
questions below.

Once the member selects or confirms a desired change likely to depend on
repeated behavior, read the behavior-followthrough owner and make one bounded
evidence pass across the foundation, relevant canonical records, connected
data, and confirmed enrichment. Before selecting a first behavior, ground the
member's outcome and reason, current routine or baseline, relevant data, prior
attempts, and the main conditions that help or disrupt follow-through. Ask up
to three short questions across separate turns to fill only decision-changing gaps—
usually two or three when those answers remain unknown, and fewer when context
already supplies them. Reuse the outcome and reason already learned. Never
re-ask a motivation that the member explicitly did not know or declined; ask
once only if it was never attempted. If motivation remains unknown, collaborate
only on a one-time first step or leave the thread open rather than activating a
Murph-designed durable loop. Save grounded reasons, concrete friction, and
support preferences through existing owners; do not infer or persist a
psychology profile, diagnosis, personality trait, or hidden motivation.

Do not activate a habit regimen, reminder, experiment support loop, or other
durable behavior-change setup while that grounding is insufficient or
decision-changing background evidence remains unconfirmed, unless the member
explicitly defers that evidence.

After thread selection and behavioral-fit grounding, onboarding must create a
visible first-value launch offer before any plan or support write. One compact
message should make a decision-changing piece of context pay off, name the
smallest useful next move, propose the exact local days/time or cue and next
viable start, and reveal the finite actionable reminder-and-review package
Murph will create. It must not recap the intake, dump the full intervention,
advertise capabilities, or reduce Murph's value to a generic reminder.

For a repeated behavior or bounded experiment, the member sees one contextual
fit reason, one-line behavior shape, the concrete next occurrence, and one
specific support-and-review promise. Detailed programming or protocol steps
stay in the canonical plan and are progressively disclosed at the moment they
become useful. The launch offer ends with one accept-or-edit question. A clear
yes authorizes the exact named plan, reminder, and review writes together; it
must not be followed by a second reminder-consent question.

Then collaborate on the smallest useful first habit, action, plan, monitoring
step, or experiment. Murph may recommend a best-fit option and explain why, but
the member chooses or adjusts what happens next. Do not dump a full protocol or
multi-part plan before that choice.

The member may leave the thread open without acting yet. If they accept a
repeated behavior or bounded experiment, use its existing owner and create the
exact finite reminder-and-review package named in the accepted launch offer in
the same turn. Do not wait for the member to ask for reminders later. Default
launch support is one actionable reminder for each planned occurrence in the
initial support window plus one early review after the first two occurrences or
within seven days. The member may edit or explicitly decline that package; a
formal tone is not an opt-out. A real route, delivery, or safety blocker is
stated rather than silently omitting support. The onboarding follow-up
automation never owns that support.

After the member's first accepted repeated behavior or bounded experiment and
its support are successfully saved, send a mandatory short text close: celebrate
the start, say Murph is excited to work with them, name the exact next scheduled
touchpoint and early review, and end with one broad invitation to use Murph for
anything else health-related. For every eligible low-risk, non-sensitive launch
on a route with `generate_song`, a privacy-safe short original song is mandatory
in the same launch turn. Formal tone, low humor, or quiet reminder support
changes the musical register, not whether the song is generated. Murph calls
the tool after the plan and support writes succeed rather than merely offering
a song or deferring it. An explicit no-music/no-audio preference, a
safety/privacy exclusion, or time-sensitive help that must be delivered first
makes the launch ineligible for music without announcing a song omission. For
an otherwise-eligible launch, only an unavailable or failed tool/route,
response-media conflict, or generation failure may omit the song, and Murph
states a plain user-facing blocker without infrastructure details.
Eligibility also requires an unused response-media slot, no time-sensitive help
that must be delivered first, and a delivery path where generation failure
cannot suppress the mandatory text close. Telegram is currently a route blocker
because it generates music during final delivery before text; this exception
ends when that path preserves the text close on generation failure. An
explicitly requested conflicting media item is also a route blocker for that
turn. The song never includes clinical or potentially embarrassing facts,
promises results, delays needed help, or substitutes for the plan. This is
reply-time delight, not a new onboarding automation.

The launch-close turn is not a movement walkthrough. Unless the member
explicitly asks to see or learn the session in that turn, do not attach
exercise-catalog media or disclose exercise-by-exercise content. Deliver that
detail progressively at the first just-in-time instructional touchpoint.

## Persistence Contract

- Save a preferred name through `memory set-name`.
- Save typed facts through their canonical structured owner when one exists,
  including goals, regimens, supplements, conditions, allergies, experiments,
  and Habitat. Use Identity or Context memory only when no structured owner
  exists.
- Save concrete aspirations as ordinary goals or ongoing needs. Use the visible
  conversation and resume context for the park-and-return sequence; do not add
  persisted parked-thread or onboarding-step state.
- The parent must verify the minimum canonical save or durable source before
  replying. A child may only enrich exact returned ids or refs. Its spawn does
  not prove or promise an enrichment result; claim child enrichment only after
  canonical readback confirms it.
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
  other slow evidence. Do not complete onboarding until each
  foundation-critical minimum fact or raw source has a verified durable receipt
  or the member explicitly defers it. Optional enrichment does not block
  completion unless it would change the next decision.
- Do not create fake records merely to remember that a category was skipped.

## Completion

Use `user_answered` only when all of the following are true:

1. The broad role, private default, and context-compounding value were delivered.
2. Minimal identity is known or explicitly skipped.
3. One or two meaningful open threads are known: a desired outcome, an ongoing
   understand-or-handle need, or an accepted explore path. Murph asked once for
   a missing reason a desired change matters; the member's reason is known or
   explicitly unknown or declined. If a legacy flow already parked the thread
   and began foundation collection without it, one light post-park recovery
   question satisfies this criterion before foundation advances further; do
   not replay the park.
4. A discovery thread was reflected, saved when concrete, and explicitly
   parked before foundation collection. An actual immediate request may be
   handled first instead.
5. All six foundation checkpoints are resolved.
6. Murph returned to an open thread with the relevant new context, unless the
   member explicitly asked not to revisit it.
7. The member chose which thread, if any, to work on now, then collaboratively
   chose a first step, explicitly chose to leave the thread open without acting,
   or declined further help on it. An activated repeated behavior or bounded
   experiment had a concrete next occurrence and exact finite reminder-and-review
   package in the accepted launch offer.
8. Useful answers and any authorized action setup are saved to canonical
   owners. Each foundation-critical minimum fact or raw source has a verified
   durable receipt or is explicitly deferred; optional enrichment is confirmed,
   not decision-changing, or handled in the parent before use. For an activated
   repeated behavior or experiment, the named support writes succeeded or an
   explicit opt-out or real blocker is recorded, and the mandatory text launch
   close was delivered. For a first launch, the song was generated in that
   turn; an explicit no-music/no-audio preference, safety/privacy exclusion, or
   time-sensitive help made it ineligible; or an otherwise-eligible
   tool/route/media/generation blocker was stated in plain user-facing language.

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
3. A member who says “I want to get stronger” in response to discovery gets one
   light motivation question before the park-and-foundation flow; a member who
   asks for a strength plan gets immediate help.
4. A member with no goal can begin with a baseline review without inventing a
   problem.
5. The useful foundation from the prior onboarding flow is still gathered,
   after the aspiration is parked and over separate turns.
6. Murph respects member control over remembered context and explains the
   available controls when asked.
7. Every onboarding question has a visible or defensible context dividend.
8. Murph returns to the open threads with relevant context, confirms which one
   the member wants to work on, then chooses the first habit, action, or
   experiment with the member rather than prescribing it. For repeated
   behavior, the choice reflects a bounded, early-stopping pass over the
   member's reason, current routine, relevant data, prior attempts, practical
   influences, schedule fit, and support fit, with up to three missing-context
   questions. The accepted launch offer makes Murph's contextual value concrete,
   names the next occurrence, and includes the finite actionable reminder and
   early-review package without a plan dump.
9. The first activated repeated plan ends with a mandatory privacy-safe text
   celebration that names the next scheduled touchpoint and invites one other
   health request. Every eligible launch also generates a short original song;
   formal tone changes its register rather than suppressing it. Delight never
   substitutes for useful action or creates another onboarding automation.
10. Context continues compounding after onboarding without a second profile
   system, automation, or completion score.
11. Supplement identity and medical context are durably saved in compact parent
    batches, and onboarding lab evidence is durably preserved before the next
    reply. Optional children enrich exact supplement ids or lab source refs
    without owning promised work. Murph claims child enrichment only after
    canonical readback confirms it.

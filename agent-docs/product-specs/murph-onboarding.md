# Murph New-Member Onboarding

Last verified: 2026-08-06

## Product Decision

New-member onboarding is aspiration-anchored and foundation-complete.

Murph first establishes a private relationship with a broad personal health
assistant. It briefly learns what the member most wants from their health and
asks only enough to name one or two open threads, then reflects, saves, and
explicitly parks those threads. Murph asks once for a missing motivation and
does not infer it; if the member does not know or declines, the motivation
remains explicitly unknown and onboarding continues. Murph gathers a
finite health-context foundation over separate turns, returns to the earlier
thread with that context, and collaborates on the first step.

After answered completion, Murph starts one private first personal read without
holding the foreground conversation open. The read spends the completed
foundation and currently available connected evidence on one specific,
personally useful interpretation. It may offer one lightweight optional next
action, but it does not automatically create a habit, plan, experiment, or
reminder. The member can keep chatting normally while the existing scheduled
runtime owns the later analysis and delivery.

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
5. After answered completion, Murph will take one bounded first look across the
   context and connected evidence and return with the most useful personal read
   it can honestly support.

Do not promise that Murph can perform an action, connect a source, or access a
record unless that path exists. Broad entry points do not weaken clinical,
privacy, authorization, or provider boundaries.

## Architecture Boundary

- Keep the existing `open | completed` onboarding state. Open onboarding does
  not gate ordinary Murph use.
- Keep the existing `finish-onboarding-followup` managed automation as the one
  finite three-day recovery and continuation mechanism. Do not add a second
  automation for unfinished context collection or split open onboarding into
  competing lifecycle owners. The first personal read below is post-completion
  value delivery, not another collection or recovery lifecycle.
  Reconciliation recognizes only the exact current seed, its immediate
  predecessor, or the bounded original legacy seed; execution remains ordinary
  scheduled send-or-skip work. One exact recognition predicate is shared by
  reconciliation, cron diagnostics/execution, and queued provider-entry
  authority. A recognized predecessor is effect-ineligible until managed
  reconciliation rewrites it to the current finite definition. A due
  predecessor enters ordinary retry/backoff without consuming its occurrence;
  a terminally stale queued predecessor intent is cleared while its source and
  pending occurrence remain reconcilable. Managed conversion defers while that
  queued intent remains attached, so hosted idle ordering cannot replace the
  predecessor identity before outbox settlement observes it. Editable slug,
  tags, title, and instructions confer no onboarding-state authority.
- Keep the 21-day post-onboarding choice point separate from unfinished-
  onboarding recovery and from the immediate first personal read. It remains
  one finite managed one-shot for members who answered onboarding, not another
  collection flow, recurring cadence, or profile.
- Create the immediate first personal read only through the structured
  `save_onboarding_first_personal_read` action after every answered-completion
  prerequisite is durable. The action accepts no prompt, schedule, model,
  route, or other fields. Code owns its fixed automation identity, current-
  conversation route binding, two-minute delay, sixty-minute execution window,
  selected model with high reasoning, and complete selection-and-presentation
  prompt.
  Generic automation save or patch cannot replace that fixed definition.
- Reuse the ordinary automation, cron, foreground-priority, and outbox owners.
  Do not add a callback, child-result handoff, result queue, scheduler, database
  table, onboarding step, or second delivery lifecycle. The scheduled root owns
  the complete analysis and final send-or-skip result; it does not spawn a child.
- Do not add persisted step state, branch state, profile completion, context
  maturity, or a data-point score. Infer progress from visible conversation,
  the existing resume snapshot, and a targeted canonical read only when the
  needed snapshot surface is omitted, truncated, or errored.
- Preserve forward progress when the bounded transcript no longer contains the
  literal park wording. Later foundation or contextual-return evidence after a
  saved aspiration establishes that the reflect-and-park transition already
  occurred; existing records without evidence that onboarding began do not.
- Enforce the relationship promise and bundled minimal identity at the first
  root-to-aspiration transition while that exchange is visible. After
  later-stage progression is established, absence of those early messages from
  bounded history does not prove omission; recover a root step only when the
  current or visible conversation affirmatively says it never happened.
- Keep member facts in their existing canonical owners: goals, memory,
  regimens, supplements, conditions, allergies, records, devices, Habitat,
  experiments, automations, and group state. Assistant runtime state is not
  product truth.
- Route useful facts to their canonical owner in the same turn they are
  learned. The parent normally saves the smallest truthful fact or raw source
  before a visible reply. For the dense foundation memo, the accepted current
  input is the durable raw source and three bounded children own the independent
  movement/protocol, supplement, and medical/safety persistence families. Use
  the resume snapshot to avoid repeating known facts.
- Hosted Codex admits root plus three concurrent V2 children. Every child is a
  one-shot leaf with one self-contained exact-source task, an existing
  canonical owner or skill, idempotent dedupe, and no authority for the other
  families, user messages, voice generation, approvals, or external actions.
  A spawn proves work started, not that writes completed. Claim saved or
  enriched details only after canonical readback. Do not add a queue or second
  state owner.
- The onboarding skill owns conversation policy. The system-prompt overlay
  routes the open lifecycle into that skill, and the managed automation resumes
  it when a useful continuation exists.
- The skill uses one package-owned progressive-disclosure asset. Its top-level
  `SKILL.md` is a complete router capped at 12 KiB and directly owns the goal,
  bounded resume check, immediate-need override, relationship promise, exact
  welcome, and minimal-identity checkpoint. Aspiration/foundation/delegation,
  persistence/recovery/follow-up, and return/launch/completion each live in one
  directly referenced file under the same skill asset. A rule has one owner;
  references do not restate the top-level policy or each other.
- A fresh greeting or vague first message reads only the compact top-level
  skill plus the one bounded `assistant onboarding resume-context` snapshot.
  It does not preload a later-stage reference. A later or resumed turn reads
  only the reference that owns its current decision; a turn that genuinely
  crosses a stage boundary may read each newly relevant owner. All reference
  files ship with the assistant-engine skill asset.
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

Learn the member's preferred name. In the same short message, ask their age and
use the active tone preference for the final identity question: casual asks
whether they are a guy or a girl, while formal asks their gender. Both details
remain optional, but the visible question does not announce that with “totally
optional” or similar copy. Accept a different self-description without
correcting or pressing them. Do not add a clinical explanation unless the
member asks. If the member declines, continue. Treat that bundled message as
one minimal-identity checkpoint rather than splitting it into three setup
turns.

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

> What would you most like from your health—something you want to improve,
> understand, handle, or be able to do?

Do not bundle this with additional intake questions. The broad anchor does not
consume the clarification budget. After it, ask no more than three short
clarifiers, one per message. For a desired change, distinguish the outcome, a
progress signal that would show it is getting better, and the reason it matters.
One answer may clearly supply more than one field or cover several named
threads. Ask only for a missing field, once. Stop when the outcome is known and
the progress signal and reason are each known or explicitly unknown or
declined. “I want to get stronger because it would build confidence” still
lacks a progress signal; “I want to deadlift 315 pounds because it would build
confidence” supplies all three fields. Never infer or re-ask an answer. When
the member names several threads, keep them all without asking which is the
main priority; that choice belongs to the return step. The available
clarifiers are:

1. What would tell the member this is getting better?
2. Why would that matter?

Do not send the bare abstract question “What would success look or feel like?”
Name the actual thread or threads and offer two to four concrete, low-pressure
examples spanning them, with room for a different answer. Examples can be
lived or observable changes such as lifting more, carrying things more easily,
falling asleep faster, or waking up rested. This clarifies how the member would
recognize progress; it does not ask Murph to design the intervention. Keep the
motivation question light. Do not excavate obstacles, failed attempts,
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

Once one or two threads can be named and the outcome, progress-signal, and
reason rule above is satisfied, reflect the actual threads in the member's
words and name them again in the parking reply. Keep a known motivation clearly
subordinate to those threads instead of presenting it as another goal. Do not
make the member recover the referent of “both,” “those,” or “them” from earlier
messages.

Save each concrete goal or ongoing need to its existing canonical owner. Before
replying, also save the member's confirmed description of progress and stated
reason as one concise Context memory associated with the named goal or goals.
Preserve the member's words and keep success, motivation, and the goal itself
distinct. Include “not sure yet” only when that was the member's own answer.
Read existing memory first and update a matching record instead of appending a
stale duplicate. Name the goal or goals inside that memory and read back both
the goal records and Context memory before saying the threads are saved. Do not
invent missing meaning or store an intervention plan. Say naturally that Murph
will keep the thread open. Do not label it as a permanent main direction or
announce internal storage mechanics.

Then explain the ordering explicitly without foregrounding a refusal to help.
For a casual member who named strength and sleep as the threads, confidence and
energy as the reason, and has not resolved the data-source checkpoint, the
complete reply may be:

> got it — stronger and sleeping better, mainly for more confidence and energy.
> before we decide where to start, i want to understand a bit more about what's
> going on around your health so the advice actually fits. do you use a wearable
> or health app?

This is a worked example, not fixed copy. Murph substitutes the member's actual
threads and reason, matches their register, and asks the first unresolved
foundation question. Before sending the data-source question, append a short
“like …” clause using only labels from the current prompt's hosted wearable
connection list: one label when only one is available and a few when there are
several. If that list is absent, omit hosted-provider examples rather than
inventing or recalling names. Apple Health stays out of this provider-example
clause and is offered only through the separate native-app relay below.

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
   is available, and a real connection path when the member wants one. When
   asking, use only provider examples named in the current hosted connection
   list, using one when only one exists and a few when several do. After a clear
   “none,” the checkpoint remains resolved, but when the current prompt includes
   the Apple Health relay and context does not rule out an iPhone or connection
   help, make one optional conditional offer: if the member uses an iPhone,
   they can connect Apple Health in the Murph app so Murph can start using the
   daily step counts the phone sends. Do not infer iPhone ownership from
   iMessage. If the member wants the link, send one short handoff in Murph's own
   words, put the canonical App Store listing alone on the final line, and wait
   for the member to return or the connection to become visible before
   advancing. Let the iOS app own sign-in, Apple Health connection, and
   operating-system permission. Apple Health is not a provider-connect action;
   do not claim permission or active step sync without live evidence.
2. **Movement and training:** current activity, exercise, training, capacity,
   injuries, or relevant limitations.
3. **Current protocols or experiments:** health changes, routines, diets,
   recovery practices, or tests already underway.
4. **Supplements:** current products, brands, and rough duration when known;
   bottle or label photos are an easier input option. The supplement child
   reads the owning skill, dedupes existing records, saves the named current
   product identity plus supplied brand/status, and enriches incomplete exact
   labels when useful. The parent does not duplicate these writes.
5. **Medical and safety context:** prescription or OTC medications, diagnosed
   conditions, injury history, allergies or intolerances, and pregnancy or
   nursing, asked once as one optional open question. The medical/safety child
   owns every supported fact and negative assertion across the named clinical
   owners.
6. **Recent blood tests or lab panels:** whether they exist and can be shared
   now or later. Match this closer to how the member answered the foundation
   invitation: generate a short voice memo only when the member answered with
   a voice memo, has not since declined voice, and the tool is available. If
   the member typed, used another modality, skipped the invitation, or there is
   no visible evidence that they sent a voice memo, ask over text. Do not
   duplicate the question when audio delivery succeeds. If audio preparation or
   delivery fails, the existing channel adapter sends the media transcript as
   text and remains the only delivery owner. If the member names Function
   Health, proactively send
   https://my.functionhealth.com/documents and ask for the Lab Results of Record
   PDFs. Naming the provider alone does not start a child. Once a PDF or paste
   exists in durably accepted input, Murph immediately sends one short,
   natural receipt update before slower preservation or extraction work. It
   says only that the report arrived and what work is starting; it does not
   claim the report is already saved, parsed, analyzed, or in the health
   record, and it is not repeated in the substantive reply. When another
   onboarding progress trigger applies in the same turn, Murph coalesces them
   into one truthful update before the slower work. The root then
   verifies or creates the durable attachment, document, or import ref before
   that substantive reply. When a V2 slot is available and
   structured extraction can materially improve later help, spawn one child by
   default from that exact source. Skip it when the source is already structured
   or extraction cannot change later help. If the current answer needs the
   parse, the parent keeps it reply-critical and uses progress updates.

Use this order by default, but pull a checkpoint forward when it materially
improves safety or keeps the conversation natural. One message, attachment, or
voice note may resolve several checkpoints. Never re-ask facts Murph already
has.

After the data-source checkpoint, ask for checkpoints 2–5 in one low-effort
invitation covering movement/training, current protocols, supplements, and
medical basics. Offer a voice memo, while telling every member that typing it
out works just as well. When visible or saved evidence shows that the member is
over 40, also offer: “I can walk you through sending a voice memo.” Never guess
age, and never delay or block the invitation when age is unknown. When a
supplied memo contains all three independent work families, immediately start
three children before replying:

1. movement plus current-protocol context;
2. supplement persistence plus useful exact-label enrichment; and
3. medical and safety persistence.

The parent does not wait. Immediately after accepted spawns, it sends one
progress update saying, in natural words, that Murph's best people are sorting,
saving, and checking what the member shared. That is a same-turn start
acknowledgement, not a completion claim, and it is not repeated in the final
reply. The final labs response follows the member's foundation-response
modality: voice after a voice memo, otherwise text. Do not duplicate a
successfully delivered voice question in text; the channel adapter may deliver
the existing transcript after audio fails.

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

For detached work, spawn one fresh child per independent family with no forked
transcript and a self-contained task containing the exact accepted source words
or durable refs, the owner or skill, duplicate avoidance, exclusions, and the
bounded result. The hosted limit is three concurrent children per root. A child may use
bounded read-only primary-source lookup when its owning skill requires it.
Every create or update must be idempotently attributable to the accepted source
or exact returned ids. Do not
delegate urgent or safety-sensitive judgment, reply-critical synthesis,
user-facing messages, approvals, voice generation, other dynamic tools,
browser or phone work, or external actions. If spawning is unavailable, use
the smallest synchronous path for required work and leave optional details
unconfirmed. Hosted Codex config must preserve Murph's custom V2 tool and mode
hints; a boolean override must not replace that config table. Children may
outlive the reply. Do not message, resume, reuse, close, interrupt, nest, or
leave a background terminal from a child. Do not keep the root turn open solely
to wait. A spawn proves only that the bounded work started. If the user's
requested answer depends on the result, keep the work in the parent, follow the
progress-update contract, and answer only from the confirmed result or an honest
blocker.

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
data, and confirmed enrichment. When that pass spans more than one source or
owner, Murph sends one short natural progress update before the first read,
names the few member-facing areas being checked and why they matter to the
chosen next step, and continues immediately. This is required even when each
individual read is routine, is omitted for one targeted read, and is not
repeated in the substantive reply. Before selecting a first behavior, ground the
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
anything else health-related. The onboarding launch close is text-only:
onboarding never automatically generates, offers, or mentions a song, and media
is not a completion criterion. A song the member explicitly requests remains
ordinary current-request media and does not become part of the onboarding
contract.

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
- When the member supplies what progress would mean or why a goal matters, save
  those words in one concise Context memory that names the associated goal or
  goals. Read existing memory first, update a matching record on correction,
  read back both owners before claiming the thread is saved, and never duplicate
  the goal, infer missing meaning, or store a proposed intervention there.
- Before replying, verify a durable accepted input, minimum canonical save, or
  raw source. During a dense foundation memo, the three children may own their
  exact named record families from that accepted source. A spawn proves only
  that work started; claim completion only after canonical readback.
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
  foundation-critical accepted input, minimum fact, or raw source has a
  verified durable receipt or the member explicitly defers it. Optional enrichment does not block
  completion unless it would change the next decision.
- Do not create fake records merely to remember that a category was skipped.

## Completion

Use `user_answered` only when all of the following are true:

1. The broad role, private default, and context-compounding value were delivered.
2. Minimal identity is known or explicitly skipped.
3. One or two meaningful open threads are known: a desired outcome, an ongoing
   understand-or-handle need, or an accepted explore path. For each desired
   change, Murph asked once for each missing progress signal and reason; both
   are known from the member's own words or explicitly unknown or declined. The
   resulting progress definition and reason are durably associated with the
   named goal or goals and read back before Murph claims the thread is saved.
   If a legacy flow already parked the thread and began foundation collection
   without one or both fields, ask each missing field once, one per message,
   before advancing; do not replay the park.
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
   close was delivered.

An experiment, plan, support loop, wearable connection, lab upload, group, or
specific positive health fact is not required.

If the member clearly declines onboarding or further setup as a whole, use
`user_declined`, complete the lifecycle, and stop asking. Do not use an overall
decline for one skipped category.

Onboarding may remain open indefinitely without blocking ordinary help. Do not
claim completion until the command reports it.

## First Personal Read

On the ordinary foreground turn that satisfies every `user_answered` completion
criterion, Murph first records and verifies answered completion, then asks the
existing automation tool to create the fixed first personal read on that same
turn and gives one truthful expectation-setting line only when that save
succeeded. The host accepts the action only when the trusted ordinary foreground
turn began with onboarding open, canonical state now reports answered completion,
the route is private, and no fixed first read exists. Failure to save never
blocks or rolls back onboarding and never produces a promise Murph cannot keep;
an archived read cannot be reactivated. A final-turn request for no proactive
follow-up completes onboarding without creating the read or promising outreach.

The occurrence becomes due two minutes after creation and expires sixty minutes
later. Foreground member messages retain priority through the existing runtime;
there is no parallel resident model writer or child callback. The scheduled
turn runs in a fresh context using the member's selected model with high
reasoning, revalidates answered completion, reads
the latest committed conversation before analysis and composition, and skips
rather than interrupting a newer urgent or unresolved task or stacking another
unanswered proactive health question.

The complete prompt is code-owned. Murph supplies only the zero-argument
structured action and cannot supply or replace instructions, timing, model, or
route. The prompt applies the same type of interestingness bar used by the
weekly health insight:

- zero or one member-specific finding;
- concrete recognizable evidence and exact goal congruence;
- source-health, freshness, coverage, and sync checks before wearable use;
- no vendor-score tautologies, proxy inferences, generic advice, data-quality
  complaints, behavioral grading, or causality beyond the evidence;
- bounded public research only after a personal candidate exists;
- a useful personal interpretation, reassuring non-finding, or low-burden
  measurement target as the only fallback; and
- silence when nothing specific and decision-relevant clears the bar.

A send is three to five natural sentences with the useful point first, the
smallest evidence needed to trust it, calibrated uncertainty, and at most one
optional low-burden next action or question. It never automatically creates a
habit, plan, experiment, reminder, purchase, booking, or other effect.

The turn reads the existing `weekly-health-insights` knowledge page before
selection and best-effort records one compact semantic candidate there under a
first-read heading keyed by the exact scheduled occurrence instant. Its body
contains only the claim, evidence, uncertainty, and canonical source paths, not
the outbound message or transport framing. The same occurrence may reuse that
candidate only after rechecking current gates and canonical evidence; an
incomplete candidate causes bounded recomputation rather than terminal skip.
Any other first-read heading suppresses another send. The page owns semantic
non-repeat only. The existing occurrence-scoped cron/outbox identity freezes
exact member-facing text after an outbox intent exists, and a failed ledger
write does not suppress an otherwise sound first read.

Adding the fieldless action changes the shared `murph.automation` tool contract,
so rollout intentionally rotates native provider threads beyond onboarding. On
the first post-deploy turn of a pre-existing automation-capable private session
or eligible non-email group session, the stored contract fingerprint no longer
matches. The planner must not resume a provider thread under a different tool
schema: it starts a fresh thread with at most 24 committed messages, 4,000 bytes
per message, and 12,000 bytes total, then returns to native resume after that
replacement thread succeeds. Rolling back the schema can cause the same session
to rotate a second time. Rollout proof uses one pre-existing private session and
one pre-existing eligible group session: each first turn starts fresh and
replies with bounded continuity, and each second turn resumes its replacement
thread. Do not add a compatibility flag, dual schema, migration, or session
reconciler around this safety boundary.

The completed first-read turn also has a separate, occurrence-time continuity
effect. Its high reasoning is a turn-scoped target override on the live private
conversation session. After either a provider-completed send or normal silent
skip, the turn finalizer preserves the member's selected provider and model but
clears native resume; retaining a provider thread across different target
options would make its contract ambiguous, while persisting high reasoning as
the member's ordinary preference would change their selected authority. The
next ordinary turn therefore receives the same bounded committed-history
fallback—at most 24 messages, 4,000 bytes per message, and 12,000 bytes total—
and later turns resume the replacement thread. Cancellation or foreground
preemption before terminal turn persistence does not rotate the session. An
outbound delivery failure after terminal persistence does not undo the reset.

## Finite Scheduled Continuation

The onboarding follow-up automation is one finite three-day recovery window,
not a category drip or a support-obligation resolver. It has one opportunity
on each of the next three local days in a stable per-member window from 1:30 PM
through 2:29 PM. Delivery authority closes at 3:00 PM on the third local day,
reserving at least 30 minutes for a healthy turn after the latest scheduled
start. Each daily opportunity is consumed after either a send or a skip; it is
never extended, restarted, or rescheduled into an unbounded cadence. Each
occurrence should read recent conversation and the resume snapshot, then do one
of four things:

1. return skip because onboarding is complete or declined; the existing
   managed-automation reconciler archives the follow-up deterministically;
2. advance unfinished aspiration capture or parking with one short,
   reply-oriented question; a parking reflection may accompany it but is never
   sent alone;
3. ask one unresolved foundation question with a clear context dividend; or
4. return to an open thread after the foundation and ask one genuinely needed
   question.

If the last onboarding question is unanswered, do not rotate to another
category or repeat its wording. A later day may use a shorter natural,
low-pressure reopening question that lets the member choose whether to
continue, without urgency or escalating pressure. Skip after an explicit
decline, a request not to follow up, or when the nudge would not be timely or
useful. Any promised proactive support continues through its dedicated
canonical automation, including after onboarding closes. Every user-facing
scheduled continuation includes exactly one easy question that invites a
reply; a reflection-only scheduled message returns skip. Normal member replies
may continue open onboarding indefinitely, but they do not extend or create
another scheduled recovery window.

The scheduled turn uses the ordinary notification send-or-skip contract and
never invokes the completion command or otherwise mutates onboarding state.
Before provider admission and again before tool execution, delivery, and
commit, the runtime reads canonical onboarding state: completed state
deterministically skips, and an unreadable state fails closed with the stable
`ASSISTANT_ONBOARDING_AUTHORITY_UNAVAILABLE` retry reason only inside the
existing finite window. The latest gate read replaces the occurrence's earlier
diagnostic snapshot, so completion or read failure during model work remains
visible. Evidence that the checkpoint is already answered, declined, deferred,
or not useful to reopen produces an ordinary skip. Only a later foreground
member reply may advance or complete onboarding through the canonical state
owner. The third-day 3:00 PM cutoff prevents a queued or delayed outbound
intent from entering the provider after the finite local window.

Migration recognizes PR 1203's exact one-shot fingerprint as well as the older
exact recurring and original legacy fingerprints. It preserves a one-shot's
stored occurrence as the window anchor and derives its recurring local minute
from that occurrence; an existing daily-local record keeps its stored minute,
so signup and maintenance never compete through different hash identities. A recurring source is exposed only
after canonical runtime state durably owns that first occurrence; if the state
write fails, the source remains the finite next-day one-shot and normal managed
reconciliation completes the conversion on a later pass.
If reconciliation cannot read authority or commit its rewrite, every recognized
predecessor remains visible in metadata-only cron diagnostics but cannot enter
the provider, tools, commit, delivery, or queued external-transport boundary.
Its due occurrence remains pending under ordinary cron retry/backoff instead of
being consumed as a completed one-shot. A terminally stale queued predecessor
intent is not retried, but delivery reconciliation likewise preserves the
canonical source and pending occurrence for managed conversion. This may
under-send during a failed migration; it cannot resurrect the older cadence,
lose the migration source, or bypass the current three-day authority.
On an ordinary hosted idle pass, managed reconciliation runs before the
automation lane drains outbox. A predecessor with a pending delivery intent
therefore stays unchanged for that pass; outbox settles the obsolete payload,
the post-delivery owner re-reads cron status so the retained retry remains a
real hosted wake, and the next managed pass performs the existing finite
conversion against the retained occurrence. This intentional authority-stale
settlement does not stage a generic delivery-failure conversation for either a
direct-thread or participant target.

Hosted queue-only delivery carries the automation revision into the existing
outbox authority fence. Immediately before external provider entry, that owner
also re-reads canonical onboarding state: completion or overall decline makes
the intent terminally stale, unreadable state remains retryable inside the
finite window, and unchanged open state may deliver. Foreground completion does
not need to race maintenance or rewrite the automation to revoke a queued
question.

Hosted observability records the seed, exact-seed reconciliation, and each
occurrence as metadata only. The records distinguish persisted onboarding
state from the missing-state default and include state status and timestamps,
the last authority gate checked, three-day window, schedule shape, model
decision, delivery outcome, and run outcome. They never contain conversation
text, vault content, or direct member
identifiers and never become a second correctness owner.

## Post-Onboarding Choice Point

After answered onboarding, Murph gets one low-pressure chance to ask what
deserves attention now. The one-shot is scheduled 21 local-calendar days after
completion and expires seven days later. Existing eligible members receive one
future same-weekday catch-up rather than an immediate late message; once
installed, its occurrence does not drift. A quiet rollout wake may reuse the
route of an active immutable member-owned managed automation, so an existing
member does not need to send another message before the catch-up is installed.

This is an ordinary member-owned managed automation in the current private
conversation. Murph uses recent conversation and targeted canonical vault
reads to understand current goals or open threads, relevant progress, and
whether another review already owns the moment. If the goal was unclear,
unshared, deliberately open, or exploratory, Murph must not pretend one exists
or manufacture a problem; keeping the thread open is a valid answer. Murph
sends two to four short sentences with one easy question or skips quietly.
Missing or messy data is not failure, and praise requires specific evidence.
The scheduled turn does not create or change goals, plans, experiments,
regimens, memories, or automations; normal conversation owns any change after
the member replies. That boundary is immutable rather than relying on editable
task wording: this exact managed identity suspends ordinary save/ingestion
guidance, removes hosted mutation tools and external network access, and keeps
only read access to the current private vault.

If live Linq authority replaces an older personal route with the member's
current home chat, that same authority supplies the raw delivery target and its
privacy-blinded conversation locator. Murph resumes the current private
conversation rather than reasoning in the old chat and delivering in the new
one.

Canonical onboarding state remains the scheduling and execution authority.
Open, declined, and manual completion do not create the one-shot, and reopened
or replaced completion state blocks a pending occurrence before delivery.

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
   health request. The close is text-only; onboarding does not automatically
   generate, offer, or mention a song.
10. Answered completion creates one bounded private first personal read through
    a code-owned action without blocking ordinary conversation or allowing the
    model to author or replace its prompt, timing, model, or route.
11. The first read sends at most one non-obvious, evidence-backed personal
    interpretation with calibrated uncertainty and one optional lightweight
    action; it suppresses generic, repetitive, data-quality, vendor-tautological,
    or unsupported findings and never creates an action automatically.
12. Context continues compounding after onboarding without a second profile
    system, context-collection lifecycle, or completion score.
13. A dense foundation memo starts one child for each supplied independent
    movement/protocol, supplement, and medical/safety family, up to three,
    from the durable accepted source. Murph replies after the spawns without
    claiming completion and confirms child-owned writes only after canonical
    readback. An accepted onboarding lab source gets an immediate natural
    receipt update before slower preservation or extraction, and the evidence
    is durably preserved before the substantive reply.

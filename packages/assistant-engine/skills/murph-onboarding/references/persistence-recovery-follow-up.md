# Persistence, recovery, and follow-up

Read the top-level `../SKILL.md` first. This reference owns the early-stall
one-shot, canonical context persistence, finite scheduled recovery, and reply
and follow-up constraints. Read it whenever the current turn persists or
interprets a skip or deferral, handles a scheduled onboarding occurrence, or
needs the cross-stage reply rules.

#### Arm the early-stall check-in

Setup drop-off is most likely in these first minutes, so in the same turn
that handles the user's minimal-identity answer, when `murph.automation` is
available, save one scheduled one-shot before the visible reply. Arm it only
in that turn: skip it when the minimal-identity prompt was never asked in this
conversation or when the flow is resuming past this point. Saving the same
slug twice converges on one automation, so a duplicate save is harmless, but
never save it on a later turn. Read the current clock first (for example
`date -u +%Y-%m-%dT%H:%M:%SZ` in the workspace) and compute `at` from that
result; do not guess the time or offset. Use:

- `action: "save"`
- `slug: "onboarding-early-stall-check-in"`
- `title: "Onboarding early-stall check-in"`
- `summary: "One-shot check-in if the user goes quiet right after starting onboarding."`
- `schedule: { "kind": "at", "at": "<now + 15 minutes, ISO with offset>" }`
- `tags: ["assistant", "scheduled", "onboarding"]`
- `instructions`: exactly the decision policy below.

```text
Onboarding just started and the user answered the first question or two. This one-shot exists only to notice a mid-setup stall. Read the recent conversation first. Return skip unless all of these hold: onboarding is still open, the latest message is Murph's own onboarding question, that question has gone unanswered for at least ten minutes, and the user has not asked to pause or continue later. Otherwise reply in chat with one short, light line in Murph's voice: check whether they are still around, keep it playful and pressure-free, and make clear they can pick this up anytime or tell Murph to take a different approach if this style is not working for them. The meaning is "hey, still there? don't leave me hanging - and if you'd rather do this differently, just say so." Use natural wording, not a fixed script. Do not repeat the open question verbatim, do not add a new setup question, and do not mention schedules, automations, or internal state. This check-in happens at most once; any later scheduled continuation belongs only to the finite managed next-day recovery occurrence below.
```

If the save fails or the tool is unavailable, continue onboarding normally
without retrying or mentioning it.


## Context persistence

Route useful answers to their existing canonical owner in the same turn. The
parent normally saves the smallest truthful canonical fact or durable source
before its visible reply. The dense foundation memo in
`aspiration-foundation-delegation.md` is the explicit exception: the durably
accepted message or transcript is the source, and its three bounded
children own the named canonical persistence families without a duplicate
foreground write.
Use structured records for typed facts such as goals, regimens, supplements,
conditions, allergies, experiments, and Habitat; preferred name through
`memory set-name`; Identity or Context memory only when no structured owner
exists. Do not dump structured facts into freeform memory or invent missing
dose, severity, date, brand, diagnosis, or motivation details.

Save a concrete aspiration as an ordinary goal or ongoing need through its
existing owner. The visible conversation and resume context carry the park and
return sequence; do not add opaque parked-thread or onboarding-step state.

The goal schema owns the desired outcome but has no narrative field for what
progress means or why it matters. Save those confirmed answers in the same turn
as one concise Context memory associated with the named goal or goals. Preserve
the user's words; distinguish “what would tell you this is getting better” from
“why this matters”; and include “not sure yet” only when that was the user's own
answer. Read existing memory first. Update the matching Context memory when it
exists; otherwise create one. Name the goal or goals inside that memory, then
read back both the goal records and Context memory before saying the threads
are saved. Do not duplicate it, invent missing meaning, turn the reason into
another goal, or store an intervention plan during aspiration capture.

Treat “none,” “not relevant,” and an explicit category skip as resolved for
conversation flow and persist the meaning so another thread does not ask
again. Save a real negative health fact through its owning surface when one
exists, including negative clinical assertions. Save a durable request not to
discuss a category as a Preferences memory in the user's words. Use Context
memory only when the factual answer is useful beyond onboarding and has no
structured owner. Do not create a fake health record or an opaque onboarding
step marker merely to track coverage.

A simple “later” remains unresolved. Save it as a preference only when the user
expressed durable timing or contact guidance that should survive this thread;
otherwise let the preserved conversation and finite managed recovery honor it.
When a saved defer or skip preference changes, update or forget that memory
instead of leaving contradictory instructions.

Use the global health-record ingestion instructions when the user supplies a
file, lab, label, record, or other slow-to-process evidence. Do not mark
onboarding complete until each foundation-critical minimum fact or raw source
has canonical readback or a verified durable source, or the user explicitly
defers it. Child enrichment does not block completion unless its result would
change the next decision; keep reply-critical parsing in the parent.

The six checkpoints are a finite new-member foundation, not a permanent
profile score. Outside this foundation, every proactive context question must
improve current help, unlock an action, resolve relevant safety, or personalize
a likely near-term follow-up. Use known context first and explain any
non-obvious context dividend.


### Finite three-day recovery

A managed owner may invoke this skill at most once on each of the next three
local days after the welcome. This fixed window is the only scheduled recovery
after the early-stall window. Each day's opportunity is consumed whether it
sends or skips; no occurrence may create, re-enable, extend, rotate, or
reschedule the owner.

- Read current onboarding state and recent user messages before deciding.
- If the latest onboarding question is still unanswered, do not repeat its
  wording and do not rotate to another setup question. A later day's
  occurrence may instead ask one shorter, natural, low-pressure question that
  lets the user choose whether to continue, without urgency or escalating
  pressure.
- A visible message must contain exactly one easy question. Do not mention
  setup completion, internal state, schedules, automations, or final attempts.
- Return skip after an answer, completion, overall decline, request for no
  follow-up, explicit deferral whose timing should be honored, newer urgent or
  safety-sensitive context, or evidence too stale or incomplete to support a
  useful reopening question. Every one of these cases uses the ordinary
  scheduled notification skip and leaves onboarding state unchanged.
- Send or skip consumes only the current local day's opportunity. The managed
  owner ends permanently after day three. Any later member reply resumes
  through ordinary reply-driven onboarding.

## Reply and follow-up rules

- Except for the bundled minimal-identity prompt in `../SKILL.md` and the
  foundation brain-dump memo in `aspiration-foundation-delegation.md`, ask at
  most one question per reply. Input affordances for that question do not count
  as extra questions.
- During aspiration capture, parking, and foundation collection, use one short
  messaging bubble, usually two to four short sentences. Apart from the
  foundation brain-dump memo in `aspiration-foundation-delegation.md`, do not
  send a list, routine, multi-part
  assessment, or several paragraphs unless an actual immediate or safety need
  requires them.
- Keep the tone low-pressure and conversational. Never say “complete your
  profile,” “finish setup,” or imply the user is behind.
- Checkpoints, records, receipts, and open/resolved status are internal
  bookkeeping, never conversation copy. Do not tell the user a checkpoint is
  open, a fact is user-reported or unconfirmed, or that something was marked or
  treated a certain way. Say the plain human equivalent instead, like “Send
  them whenever—I'll take a look then.”
- Do not recap the whole flow or advertise every feature.
- Do not re-ask saved, answered, skipped, declined, or irrelevant context.
- A deferred checkpoint remains open, but honor the requested timing.
- If the last onboarding question is still unanswered, do not send a different
  setup question. Wait for a reply or later inbound message instead of
  escalating a drip questionnaire. Inside the first-minutes stall window, the
  scheduled early-stall check-in above is the only permitted nudge and it never
  repeats. The separate finite three-day recovery rule above owns the only
  later scheduled exception.
- Skip visible onboarding advancement when the user asks for no follow-up, the
  situation is urgent or safety-sensitive, the immediate task failed and needs
  attention, or the current health-data reply should stand alone.
- Skip conditions suppress a visible question; they do not complete onboarding
  or cancel the canonical completion operation when every criterion is already
  satisfied. During the finite scheduled occurrence, leave state unchanged.
  During ordinary reply-driven onboarding, use the direct command.

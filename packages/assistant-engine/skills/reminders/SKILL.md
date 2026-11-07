---
name: reminders
description: Use in a private conversation before creating or changing a reminder, check-in, review, scheduled summary or other automation with murph.automation, including the reminder Murph sets for a confirmed appointment. Covers time selection for vague requests, stored-instruction wording, continuity, wearable-data timing and outdoor reminders.
---

# Reminders and scheduled automations

`murph.automation` owns exact arguments, schedules, patches and routing; read
its full description and schema before calling it. This skill owns how to
author what it saves.

## What to store

- Save the task and its concrete execution or stop conditions. Do not add
  generic change or pause offers to stored instructions unless the member asks
  for that repeated copy. Explain available controls during setup when useful.
- Prefer bounded, context-aware automations. For passive monitoring, default to
  a digest or summary. Murph-designed habit support needs request-specific
  skip and repair rules and an off-ramp. Do not invent a check-in or review
  lifecycle for an ordinary recurring reminder: an explicitly requested ongoing
  reminder sends every scheduled occurrence until the member pauses or changes
  it; silence never stops it.
- Write stored instructions in the member's everyday words. Open with a
  privacy-safe description of the plan, task or item, and describe related
  messages by what they say and when, not by internal role names such as cue,
  check-in or review. After hours of unrelated chat, the recipient must know
  what the message is about from the message alone; a title, slug, metadata or
  preserved thread is not enough. Unless the member dictated exact copy or the
  action already makes the subject unmistakable, the message names the
  specific task, behavior, plan or item, never only "it", "this", "the timing"
  or "the plan".
- Ordinary reminders, check-ins and light support use the default continuity;
  do not restate it. Use `continuityPolicy: fresh` for larger automations such
  as research, audits, roundups, content inspection, or any recurring task
  likely to need several tool calls, so each run starts from current evidence.
  A new automation inherits this conversation's delivery route; a preserve
  automation continues this conversation instead of starting a new thread.

## Choosing a one-shot time

- Classify timing before any optional read. An exact clock time is final:
  keep its day or date and time, do no pattern, routine, wearable or calendar
  read to choose or alter it, and save the fixed one-shot `at` shape. Never
  round, move, skip or reinterpret it; past-time and daylight-saving recovery
  still apply without silently choosing another time.
- A broad window such as morning, afternoon, evening or "sometime that day"
  hands you the clock time. Start with injected saved context and routine
  schedules; read only missing evidence that could change the choice with
  `vault-cli memory show --compact --format json`, `vault-cli wearables sleep
  pattern --format json`, one bounded `vault-cli wearables activity list ...
  --format json`, or one exact routine record.
- A connected calendar can change the chosen time, so before choosing, when
  connected-app tools are available, call `murph.connected_apps_manage` once
  with unfiltered `action: list`. With exactly one active Google Calendar or
  Outlook account, discover the read schema through `murph.connected_apps_search`
  and call `murph.connected_apps_execute` once for only that account, local date
  and window. The connection authorizes this narrow read; do not ask
  permission. Never guess or fan out.
- If evidence, account selection or an optional tool is absent, ambiguous,
  sparse or failed, continue without a timing question. Fallbacks: 09:00
  morning, 14:00 afternoon, 19:00 evening, 12:00 otherwise.
- Save exactly one fixed `at` reminder inside the window. Never add
  `skip-when-busy`, availability or account bindings, runtime calendar reads or
  dynamic rescheduling. Do not copy selection evidence or provider content into
  instructions or `contextReferences`, and never expose event titles,
  attendees, notes or account details.
- After success, begin with the reminder subject, date and time, never just
  "Reminder saved". Add one truthful privacy-safe reason and say the time can
  be changed.

## Calendar connection offer after a vague reminder

- Only after a vague reminder save succeeds, and only when the account list
  proves no eligible calendar is connected, consider one concise connection
  offer. Never infer absence from ambiguity or failure, and never start a
  connection without acceptance. First read exact memory unless already known.
- Suppress the offer for Instructions text `Never proactively offer calendar
  connection for reminder timing.` or a Context record beginning `Calendar
  connection offer for reminder timing —` whose `do not re-offer before` date
  is today or later.
- If eligible, update that Context record by id; use `vault-cli memory upsert`
  only to create it once when absent. Its exact text is `Calendar connection
  offer for reminder timing — last offered: YYYY-MM-DD; do not re-offer before:
  YYYY-MM-DD.`, with today and 14 calendar days later. Inspect the returned
  record before offering; on read or write failure, omit the offer and leave
  the reminder unchanged.
- Explicit calendar setup bypasses suppression. An explicit never-ask-again
  request saves the Instructions text above; for this named offer, the dated
  record governs ordinary re-offers despite the generic decline rule.

## Appointment reminders

- When this conversation establishes a confirmed future appointment, ensure
  exactly one one-shot reminder exists. Reuse or patch an existing reminder
  when conversation or tool evidence proves it covers that appointment; never
  knowingly create a duplicate. A reminder alone does not require the
  appointment-scheduling skill.
- Use the appointment's known local timezone, otherwise the vault timezone. A
  member-specified reminder time overrides these defaults. For a start before
  10:00 AM, remind the prior evening at the member's known usual pre-bed time,
  otherwise 8:00 PM. For a start at 10:00 AM or later, remind at 8:00 AM that
  day. If that default has passed, choose the latest still-useful future time
  that leaves any known preparation or travel buffer; never create a past or
  after-start occurrence.
- Never create one for a hypothetical, tentative, canceled, completed, or
  date-or-time-unknown appointment. When a confirmed appointment is canceled or
  rescheduled and evidence identifies its reminder, archive it or patch its
  timing. When an appointment is clearly booked but its date or start time is
  missing, ask only for that detail. Mention the reminder only after its save
  and timing are verified.

## Wearable-data summaries

Imports can lag events by three to six hours. When choosing a time to report a
completed wearable-data period, prefer the next day after a several-hour
buffer; otherwise late morning local time. Honor an exact time, but if it risks
partial data, say so briefly and offer the buffered option without moving it.
Do not shift action-timed cues such as bedtime reminders. Stored instructions
name the completed period and metrics, count only dates with data, show
coverage only as counts such as "6 of 7 days", and never treat a missing date
as zero; leave timing rationale and other data caveats out of them.

## Outdoor and weather reminders

Before authoring or running one, read
`$MURPH_ASSISTANT_SKILLS_ROOT/connected-apps/references/reading.md`. Store
instructions to resolve location at each occurrence before reading weather;
never freeze an incidental current city into recurring instructions. Keep
explicitly fixed destinations and timing. When the member gives a city or
region for this purpose, also save that coarse location once with `vault-cli
memory upsert` with its date and any known validity window; it is context, not
a permanent current location.

# Experiment reminders, check-ins, and summaries

Read this with `setup.md` when setting up a run, and on its own when the member
asks to add, move, pause, repair, or stop support for a run that already
exists. Repairing support does not mean redoing the experiment setup.

The member should never have to remember to report back. Murph either reminds
them before a session, records the session itself, or asks once afterwards.

## What to offer with a run

Name each piece that fits the run in the setup offer, with its time. One yes
covers every piece the offer named (`setup.md`). Later additions need their own
yes. Do not make the member choose times from nothing: read the protocol's
timing limits, the run's schedule, recent sleep and wake times, usual workout
or meal windows, and saved preferences, then propose one time with a short
reason ("around 7:45 pm, before your usual wind-down"). When that context is
missing or contradictory, pick a sensible time for the window they gave and let
them edit it. "Tomorrow around 5" is usable as given, and "between 5 and 6"
means 5.

1. **First-session reminder.** For a first session later than today, offer one
   reminder that fires 15 minutes before it (or another lead the member or the
   plan chooses) and walks them through the session. If they start today, or
   decline reminders, give the walkthrough in your reply after creating the
   run. If they do not know the time yet, or there is no route to deliver a
   reminder, create the run without it and tell them what detail to send later.
2. **Session reminders.** One finite reminder per planned intervention session
   through the intervention window. When per-session reminders would be noise,
   or the member prefers quiet, a single review can replace them.
3. **After-session check-in.** Only for sessions Murph cannot sense and cannot
   assume (see the two lanes below), when a missing log would lose information
   the experiment needs.
4. **Day-four and final summaries.** For a run with at least four intervention
   days: one progress note on day four and one results review the morning after
   it ends. Murph schedules these itself once the run records
   `--notification-style send_scheduled_summary`; never create automations for
   them. Record `skip_by_default` when the member declines or the offer left
   them out.

When a run has a baseline or run-in period before the intervention, do not
treat the time the member gives as session one without settling whether that is
when the baseline starts. Baseline reminders prompt baseline logging, never the
intervention.

After saving, tell the member when the first reminder comes and that they can
move or cancel it.

## The first-session walkthrough

The first session needs instruction, wherever it is delivered. Build it from the
saved experiment, its plan or protocol snapshot, and the setup answers, and
keep it to what session one needs: the starting version, the key steps, the
pain ceiling or stop rule, what Murph records automatically, what Murph may ask
about afterwards, and that they can answer in their own words. Offer more detail
if they want it.

Give the walkthrough once. If your reply already gave it, say so in the
first-session reminder's instructions so that reminder stays a short nudge.

## Two lanes that need no logging from the member

**Assumed sessions.** For a simple scheduled routine that Murph cannot sense,
such as sauna, tretinoin, red light, or a supplement
(`progress.adherence.evidence.eventKind` is `intervention_session` with a
calendar target of one session per day), tell the member once: "I'll assume
each session happens on schedule. Just tell me if you skip one." Do not create
per-session "did you do it?" messages. Reminders before a session are still
available.

**Wearable-sensed sessions.** After creating the run, read
`vault-cli experiment progress <id> --format json`. When
`progress.adherence.evidence.eventKind` is `activity_session` and
`progress.dataCoverage.activityProviders` is not empty, the wearable record is
the log. Do not ask the member to log, do not create "log it" reminders, and do
not save the workout through any other command.

- Tell the member what counts. Every kind in
  `progress.adherence.evidence.activityKinds` counts, and
  `minimumDurationMinutes` is the minimum length: "Cycling can be your usual
  setup, but walks, rowing, and elliptical sessions of at least 35 minutes count
  too." Add one line such as "Qualifying sessions count automatically from your
  WHOOP. No need to tell me when you do one." Name the provider only when
  `activityProviders` shows it.
- You may offer one progress nudge that reacts to a sensed workout. Save it with
  `slug: "experiment-activity-nudge-<experiment-slug>"`,
  `schedule: {"kind":"deviceActivity","after":"<current ISO timestamp>","activityKind":"<kind>"}`,
  and an `activeUntil` at the end of the support window. Use
  `progress.adherence.evidence.activityKind` when the run has a single target
  kind, and `activity` otherwise. Leave out `source`. Its instructions must
  stand alone: run `vault-cli experiment progress <experiment-slug> --format json`
  and send one short celebratory line with the count ("Nice run, that's 8 of 24
  for your base block") only at a moment that earns it, such as the first
  sensed session, halfway, target met, or a recovery after falling behind.
  Otherwise skip. It never asks a question and never asks the member to log.
  Record `activity_nudge_automation_slug` as a setup answer.
- When `eventKind` is `activity_session` but `activityProviders` is empty, treat
  the run as manual for now: keep session reminders and logging, create no
  nudge, and tell the member "Once your workouts start syncing, qualifying
  sessions will count automatically."

## Saving the automations

Use `murph.automation` and follow its schema. This section adds only what is
specific to experiments.

Save the run first, with the consent the member gave (`setup.md`): reminders
need `--reminders-enabled`, check-ins and reviews need a `--check-in-cadence`
other than `none`. Then every automation for the run sets:

- `supportSeriesId: "experiment:<experimentId>"`, with the id copied from the
  run-creation result or a read of the experiment. If you cannot identify
  exactly one run, save nothing. The series `experiment-lifecycle:<experimentId>`
  belongs to Murph's own summaries; never use it.
- `contextReferences: [{"entityKind":"experiment","entityId":"<experimentId>"}]`.
- `supportKind`: `reminder` for a cue before a session, `check_in` for an
  after-session question, `review` for a decision review, `weekly_digest` for a
  weekly summary (which also needs `--weekly-digest-enabled`). A review is a
  decision point and a digest is a summary; do not swap them.
- A one-shot schedule:
  `{"kind":"at","localAt":{"date":"<YYYY-MM-DD>","time":"<HH:MM>","timeZone":"<IANA zone>"}}`.
  The tool does not accept an ISO timestamp in `schedule.at`. Use a recurring
  schedule only when the member asked for one, with `activeUntil` no later than
  the end of the support window.
- `plannedOccurrenceOffsetMs`: the gap between the reminder and the session it
  is for. `900000` for the 15-minute first-session lead, `0` when the reminder
  fires at session time.
- `slug`: `experiment-first-prep-<experiment-slug>-<YYYY-MM-DD>` for the
  first-session reminder, and
  `experiment-session-support-<experiment-slug>-<YYYY-MM-DD>-<HHmm>` for each
  session reminder, so two sessions on one day do not collide.

Record the choice on the run with `--setup-answer`: `first_session_start_at`,
and `session_support_status` set to `scheduled`, `declined`, or `blocked` (with
`session_support_blocked_reason` when blocked).

**Instructions.** The scheduled turn can read the whole vault, so write the
purpose and when to skip, and leave out fixed message text, read lists, and
anything copied from the plan. Embed exact wording only when the member dictated
it.

- Every reminder skips when the run is inactive, the member cancelled or
  declined reminders, the session is already logged, the saved plan changed, or
  the support window has ended.
- The first-session reminder also says: "This is the user's first time doing
  this experiment. If sending, give a brief first-session walkthrough, not just
  a reminder."
- A session reminder is short and written for someone who knows the plan: the
  action for that day (or the baseline log, during baseline), and what Murph
  records or may ask later. It raises the stop rule only when new context makes
  it relevant, and it does not ask whether they did it.
- A check-in runs
  `vault-cli experiment followup due <id> --kind missed-log --date <sessionDate> --format json`,
  skips when `decision.action` is `skip` (an assumed session returns a skip such
  as `session_assumed`), and sends only on `notify`. It asks once, neutrally,
  whether the session happened and for the missing subjective details; Murph
  works out totals from the answer. For a pre-bed protocol it fires shortly
  after the member's usual wake time and asks about the night before.
- When follow-through depends on the member's own effort, include the short
  version of what keeps it going: the behavior, their reason, the time or cue,
  the tiny and fallback versions, and what to change after misses.

**Rotations.** When exercises or targets alternate, keep the rotation's start
and rule in the experiment's setup answers, along with any one-day exception.
Reminders refer to the experiment and work out that day's target from its plan
and the local date; they never carry their own copy of the rotation. A one-day
repeat or correction does not reset the rotation.

## Changing or repairing support for a run

- To move a reminder, patch the schedule of the existing automation and nothing
  else.
- When support has gone stale, or the member changes the rotation, list the
  whole series with
  `vault-cli automation list --support-series-id experiment:<experimentId> --compact`
  (follow every `nextCursor`), update the experiment first and re-read it, patch
  the reminders that should stay, and then call `murph.automation` `reconcile`
  with the series id and the `desiredAutomationIds` that should remain. An
  empty list archives the series, which is right for a pause, a stop, or the end
  of the run. Reconcile changes which reminders exist; it does not rewrite the
  ones that stay.
- Decide which automations belong to the run from the series id, never from a
  slug, tag, title, or text.
- Keep one-day pauses and unrelated reminders the member asked for. Do not
  silently archive a clinical or safety reminder; ask, or switch it to a review.

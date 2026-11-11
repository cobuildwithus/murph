# Workout reminders and replies to them

Read this when a member replies to a workout reminder with a set result, or
when you save a reminder for a saved workout. Commands are in
`tracked-table/SKILL.md`.

## What a reminder carries

A delivered reminder, and the member's later reply in the private chat, can
arrive with ids the host kept: `automationId`, occurrence timestamps,
`supportSeriesId` and `contextReferences`. They tell you which reminder this
was and which records it pointed at. They are not evidence that a workout
exists or that any set was done, and they do not authorize a write by
themselves. The member does not need to use iMessage Reply for them to apply.

## The reply names or carries a workout id

Read that workout with `vault-cli workout show <evt_id> --format json` and
change only that record. If the set the member means is missing, already
complete or different from what they describe, ask. A finished workout can
still take a clearly requested extra set.

After a successful start or set write, the host may keep that one workout
reference for the member's next messages. Use it the same way: read the
workout, apply only what the member asked, and check that the result names the
same workout. If the reference has been cleared, more than one workout is
attached, or a result names a different workout, stop using it and ask. A
later reminder or message about something else does not change which workout
is current.

## The reply carries a reminder id and no workout

Recover what the reminder was for before asking the member to repeat it. Do
this unless a workout reference was explicitly cleared or did not match, in
which case ask.

1. Call `murph.automation` with `action: inspect` and the exact `automationId`
   as `lookup`. Do not patch the reminder.
2. Look at its returned `contextReferences` first, then its `title` and
   `instructions` together with the reminder text that was delivered.
3. Follow what it points to:
   - **A regimen or an experiment.** That record owns the completion. Log it
     through that record's own skill. No workout is needed.
   - **A saved workout format** (`workout_format` reference). Read the format
     with `vault-cli workout format show <format id> --format json`. When the
     member's message clearly completes one of its sets, run
     `vault-cli workout start --routine <format id>`, keep the returned id, and
     log only the set they reported.
   - **A standalone workout described in the reminder, with no saved format
     and no existing workout.** Start one workout with the complete
     `workout start` command, keep its id, and log only the set and values the
     member reported.
4. If the reminder's definition is incomplete, or the exercise or owner is
   unclear, ask one short question and write nothing.

A numbered reminder ("set 3") does not show that earlier sets happened, so
leave every set the member did not report open. Later replies use the new
workout in the normal way. An older unfinished workout neither blocks this
start nor needs closing, and never gets an end time from a reminder.

## Saving a reminder for a saved workout

Find the format with `vault-cli workout format show <lookup> --format json`,
or use the result of creating it, and copy its id into the reminder:

`contextReferences: [{ "entityKind": "workout_format", "entityId": "<exact format id>" }]`

If you cannot identify exactly one format, save no reference. Never build the
id from the reminder text, a title, a card or the most recent format.

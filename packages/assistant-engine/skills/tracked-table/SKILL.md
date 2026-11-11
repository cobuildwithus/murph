---
name: tracked-table
description: Live workouts in a private conversation. Start one, log, correct or clear sets, finish it, and show the workout card. Also covers plain compact tables.
---

# Live workouts and tables

A live workout is one saved workout event. The member logs by texting, each
change is one `vault-cli workout` command on that event, and the reply is a
fresh card built from the saved result. Keep no other copy of the workout: no
table file, memory note or second record. A card is a snapshot. Cards already
sent never change, and the buttons on an iMessage card only put a command into
the member's message box for them to send.

A saved workout format holds a plan: its exercises, planned sets and targets.
The workout event holds what happened. A target is never written into a set as
if the set were done.

## Commands

```sh
# Start with the member's own exercises: one --exercise per exercise, in order
vault-cli workout start "<name>" \
  --exercise 'name=<exercise>;mode=<mode>;unitOverride=lb|kg;sets=<n>;reps=<n>' \
  --exercise 'name=<exercise>;mode=<mode>;targetWeight=<n>;targetWeightUnit=lb|kg;sets=<n>' \
  [--type <activity type>] [--note "<text>"] [--started-at <ISO time>] --format json

# Start from a saved format
vault-cli workout start --routine "<format name or id>" --format json

# Read
vault-cli workout show <evt_id> --format json
vault-cli workout format show "<format name or id>" --format json
vault-cli workout units show --format json

# Log or correct one set
vault-cli workout set log ["<exercise name>"] --workout-id <evt_id> \
  [--exercise-id <id> | --exercise-order <n>] --set-order <n> \
  [--reps <n>] [--weight <n> --weight-unit lb|kg] [--duration-seconds <n>] \
  [--distance-meters <n>] [--rpe <n>] [--bodyweight-kg <n>] [--assistance-kg <n>] \
  [--added-weight-kg <n>] [--type normal|warmup|dropset|failure] \
  [--note "<text>"] [--require-existing-set] --format json

# Undo one set without renumbering the others
vault-cli workout set clear ["<exercise name>"] --workout-id <evt_id> \
  [--exercise-id <id> | --exercise-order <n>] --set-order <n> --format json

# Add or remove an exercise
vault-cli workout exercise add "<exercise name>" --workout-id <evt_id> --order <n> \
  --mode <mode> [--unit-override lb|kg] [--sets <n>] --format json
vault-cli workout exercise remove ["<exercise name>"] --workout-id <evt_id> \
  [--exercise-id <id> | --exercise-order <n>] --expected-revision <n> --format json

# Store or withdraw "every set of this exercise is N reps"
vault-cli workout exercise set-reps ["<exercise name>"] --workout-id <evt_id> \
  [--exercise-id <id> | --exercise-order <n>] --reps <n> --format json
vault-cli workout exercise set-reps ["<exercise name>"] --workout-id <evt_id> \
  [--exercise-id <id> | --exercise-order <n>] --clear --format json

# End a workout early, or end one that has no planned sets
vault-cli workout finish --workout-id <evt_id> --format json

# Delete a whole workout (the revision comes from a workout show of that workout)
vault-cli workout delete <evt_id> --expected-revision <n> --format json
```

Fields inside one `--exercise` value are separated by semicolons.

- `mode` is required. Use `weight_reps` for cable, machine, dumbbell, barbell,
  kettlebell and other resistance work, even when the member has not given a
  load yet. Use `bodyweight` for unloaded repetitions. Use
  `assisted_bodyweight`, `weighted_bodyweight`, `duration` or `cardio` only
  when that is the kind of result the member will report. Ask one question
  when you cannot tell which kind it is.
- Every `weight_reps` exercise needs a unit, or the command is rejected. When
  the member stated a load, pass `targetWeight=<n>;targetWeightUnit=<unit>`.
  Otherwise pass `unitOverride=<unit>`. Take the unit from the member's
  message. If they gave none, run `vault-cli workout units show --format json`
  and use the saved strength unit. If there is none saved, ask whether they
  mean lb or kg. Never make up a unit or a load. A `bodyweight` exercise takes
  no unit.
- `sets=<n>` is the number of sets the member stated. When they gave no number,
  leave `sets` out, and the exercise gets one open slot to log into.
- `reps=<n>` is only for one exact count the member gave for every set of that
  exercise ("3 sets of 15"). Never take it from a range, "as many as possible",
  a target, an earlier workout or your own suggestion.

After any command that changes a workout, read the whole command result. If it
contains a `session_id`, call `write_stdin` until the command has finished, and
allow 30 seconds for the first wait. Never retry or replace a workout write
while its outcome is unknown, because that can create a second workout or a
second set.

## Which workout

Act on a workout only when you have its exact id from one of three places: the
result of a start or write earlier in this exchange, the marker on the card the
member's message came from, or the workout reference the host attached to this
message. Check that each write result names that same id. With no id, or more
than one plausible workout, ask which workout and set the member means. Never
pick the most recent workout.

Once a workout is established in the exchange, short follow-ups such as
"set 2 done" stay on it, even when the member calls it a routine, spreads the
sets across the day, or leaves out the exercise name. Other unfinished workouts
are fine and stay untouched. Starting a new workout never ends an older one.

Read the workout with `workout show` before a write unless this conversation
already shows its current state, from a start or write result or from the card
you sent after it.

When the member names yesterday, an older date, an older workout id or an older
card, change only that workout.

## Start a workout

A request to start a live workout is consent to create it, so run the start
before replying.

1. **Work out the exercises.** If the member names a saved format, look it up
   with `workout format show`. Otherwise keep every distinct exercise they
   named, in their order, including close variations. Dictated messages often
   lack punctuation: "standing seated and kneeling cable presses" is three
   exercises, standing cable press, seated cable press and kneeling cable
   press. Ask only when the exercise names are still unclear.
2. **Check the set counts.** If the member gives one total for several
   exercises without saying how it splits ("8 sets total of rows and curls"),
   ask how many sets each exercise gets and create nothing yet. Never divide
   the total yourself. A count given per exercise ("3 sets each") needs no
   question.
3. **Run one `workout start`** that contains every exercise. Use `--routine`
   for a saved format or `--exercise` values for the member's own list, never
   both. Never start an empty workout and add the exercises afterward. Never
   run the start a second time because a card or reply had a problem.
4. **Keep the returned `eventId`** and use it for every later command.
5. **Send the card** built from the start result and end the turn with no
   text. For a saved format, read the format first so the card can show its
   targets.

`workout format log` records a workout that is already over. Never use it to
start a live one.

## Log, correct or clear a set

Every set command passes `--workout-id`, one exercise selector and
`--set-order`. Prefer `--exercise-id`. Otherwise use `--exercise-order` or the
exact exercise name. Sending the same command again lands on the same set, so a
repeat never adds a duplicate.

Pass only the values the member stated. Never fill in weight, repetitions,
effort, assistance or rest from a plan, an earlier workout, the time elapsed, a
reminder or your own suggestion.

- "Bench 185 for 8" logs the next open bench set:
  `--weight 185 --weight-unit lb --reps 8`.
- "Same weight, 6" reuses the weight of the set just before it in that
  exercise, because the member said "same".
- "Last rep spotted" goes on that set as `--note "final rep spotted"`. Save
  every remark about a set in its note so it is not lost in the chat. If the
  member uses shorthand of their own, ask once what it means, then save it as
  a plain note.
- "Ok", "yes" and "got it" are acknowledgements. They do not complete a set.
- When a new result conflicts with a set that is already logged and the
  member did not clearly ask for a correction, ask.
- An extra set on a finished workout is allowed when the message names that
  workout and the exercise and set. It moves the workout's end time to that
  set.

Carry out every change the message asks for, in order. Then send one card from
the final result, with no text and no cards in between. If nothing changed,
send no new card.

### When the member says "done" without a count

Run `set log` without `--reps`. What happens depends on the exercise's
`memberRepsPerSet` in the workout:

| `memberRepsPerSet` | What to do |
| --- | --- |
| A number | The command fills in that count. One "done" logs one set. |
| `null` | The member withdrew the every-set count. Ask for this set's repetitions. |
| Not present | The command is rejected. If a saved instruction from the member clearly gives an every-set count for this exact exercise in this workout, store it with `set-reps --reps <n>` and log again. A matching exercise name alone is not enough. Otherwise ask for the repetitions. |

When the current message gives a new every-set count ("all sets of 12 from
now"), store it with `set-reps --reps <n>` before logging. When the member
withdraws it, run `set-reps --clear`. When one count clearly covers every
exercise in a list, store it on each. The stored count fills only a set that
has nothing logged yet. Correcting the note or load of a logged set keeps the
repetitions it already has.

### Commands sent from card buttons

An iMessage card inserts one of these for the member to send:

- `Log workout exercise 2 set 1: ...`
- `Correct workout exercise 2 set 1: ...`
- `Finish this tracked workout.`

The numbers are positions on that card, counted from 1.

1. Take the workout id from that card's marker in the conversation. If the
   marker is missing or more than one card could be meant, ask which workout.
2. Read the workout with `workout show`. If it is missing, say so and stop. Do
   not move to another workout.
3. For Finish, run `workout finish`. A workout that is already finished needs
   nothing more.
4. Check that the card's exercises and set counts still match the saved
   workout. If a position no longer points to exactly one set, ask. An old card
   never overwrites a newer result.
5. Turn each position into the saved `order` value, since a saved format can
   skip numbers. Then run `workout set log` with `--exercise-order`,
   `--set-order` and `--require-existing-set`, passing only what the member
   stated. Use the same selectors for `workout set clear`.
6. Send the refreshed card.

## Finish

Logging the last planned set of a workout that has planned sets finishes it in
that same write, with that set's time as the end. Do not run `workout finish`
afterward.

Run `workout finish` only when the member ends early or the workout has no
planned sets. When one message has both a set result and "I'm done", log the
set first and then finish. Never work out an end time from a reminder,
midnight, a stored duration or the last write.

## The workout card

Call `murph.attach_response_card` after a start, after the changes a message
asked for, or when the member asks to see the workout. The card is the whole
reply.

```json
{
  "card": {
    "kind": "compact_table",
    "version": 1,
    "title": "Strength workout",
    "subtitle": null,
    "footer": "Reply with the exercise, set, and result.",
    "tracking": { "kind": "workout", "entityId": "evt_01K1ABCDEFGHJKMNPQRSTVWXYZ" },
    "workout": {
      "version": 1,
      "state": "active",
      "exercises": [
        {
          "name": "Bench press",
          "sets": [
            { "status": "pending", "target": "185 lb × 6–8", "actual": null }
          ]
        }
      ]
    }
  }
}
```

- Build it from the saved workout, keeping the saved order of exercises and
  sets. Include every set, including open slots and sets the format did not
  plan. Leave out `rowHeader`, `columns` and `rows`.
- `status` is `completed` when the set has a result, `pending` when it has none
  and the workout is still live, and `skipped` when it has none and the workout
  has ended. Only a completed set carries `actual`.
- `target` comes from the matching planned set of the saved format. Without a
  format, use what the member stated when the workout started: `<n> reps` from
  `memberRepsPerSet`, combined with the load when `targetWeightPerSet` and
  `targetWeightUnit` are present. Otherwise use `null`.
- `state` is `completed` only once every remaining `pending` set has become
  `skipped`.
- `tracking.entityId` is the workout's exact id. Keep `subtitle` null, because
  progress is shown from the sets.
- The footer is shown on every device, so tell the member to reply with the
  exercise, set and result. Do not tell them to tap something.
- Send the complete card and let the tool check its size. Never guess that it
  is too big, and never ask the member to delete or merge exercises so it fits.

Reply in plain text only when the card tool is unavailable or rejects the
complete card, the workout or its format targets cannot be read, or a card
alone would not answer what the member asked. Never say a write succeeded
before its command result shows it. Do not send a card unprompted unless a
reminder or automation the member set up calls for one.

## Less common cases

- **Replies to a workout reminder**, and saving a reminder for a saved
  workout: read
  `$MURPH_ASSISTANT_SKILLS_ROOT/tracked-table/references/reminder-replies.md`.
- **Replacing an untouched draft workout with a new one**: read
  `$MURPH_ASSISTANT_SKILLS_ROOT/tracked-table/references/replace-draft.md`
  before proposing or doing it. An ordinary request to start a workout never
  deletes another one.
- **A plain table, or a table for an older workout**: read
  `$MURPH_ASSISTANT_SKILLS_ROOT/tracked-table/references/tables.md`.
- **Reordering exercises, or another change the commands above cannot make**:
  use `vault-cli workout edit <evt_id>`, which replaces the whole exercise and
  set structure. Read the complete workout first and send back every field you
  were not asked to change, keeping each exercise's `sourceExerciseId` or exact
  name. Use `--clear-workout` only when the member wants all exercise detail
  removed and the event kept.

---
name: tracked-table
description: Use when a private Murph member asks to start or update a live workout, log or correct sets, finish a workout, show a workout table, create a structured tracker, use a native workout card, or refresh a tracked table. Owns canonical live-workout mutations and compact native table presentation.
---

# Tracked workout and table

## Goal

Make workout logging easier than opening a dedicated tracker while keeping one canonical workout record that the member can inspect for months. Text is the write interface; a compact table is an immutable presentation snapshot.

A tracked `compact_table` may add structured `workout` detail for one open or just-finished strength workout. An ordinary `compact_table` remains the right surface for arbitrary tables, historical comparisons, or tracked data that is not one live workout.

## Core invariant

A saved workout format owns the plan: ordered exercises, stable `sourceExerciseId` values, planned sets, and target values. One canonical `activity_session` workout event owns what actually happened: session timing, ordered exercises, completed set values, notes, and the routine reference.

The canonical event is the only mutable authority. Never create a parallel tracker file, table document, memory record, database row, mutable card record, or app-only workout state. Cards are immutable presentation snapshots. The Messages extension is offline and unauthenticated; its controls only insert visible commands into the current composer, and the member still sends the message. Only the normal Murph message path may mutate canonical workout state.

A prior bubble never changes in place. Updating a workout means mutating the canonical event through the guarded command surface, verifying the result, and, when canonical state changes, sending a new snapshot on a supported private card route. The native URL must not contain the canonical event id, member identity, credentials, or write authority.

For ordinary live logging, use the targeted workout commands below. Do not reconstruct and replace the complete nested exercise/set array in model-authored shell arguments. The targeted commands read, preserve, validate, and rewrite the complete canonical structure inside the workout use-case boundary.

## Live workout command surface

- Start: `vault-cli workout start [name]` with optional `--routine <format lookup>`. Preserve the returned canonical `eventId`.
- Read one workout: `vault-cli workout show <evt_id> --format json`.
- Replace one explicitly approved ad-hoc workout: `vault-cli workout replace <name> --workout-id <evt_id> --expected-revision <n> --confirm-delete [--exercise 'name=...;sets=...']`.
- Add an exercise: `vault-cli workout exercise add <name> --workout-id <evt_id> --order <n> [--sets <n>]`. An explicit `--sets` count is a finite plan; omitting it creates one targetless log slot.
- Store a fixed repetition prescription: `vault-cli workout exercise set-reps [exercise] --workout-id <evt_id> --reps <n>`.
- Log or correct a set: `vault-cli workout set log [exercise] --workout-id <evt_id> --set-order <n>`.
- Undo one set without shifting later set numbers: `vault-cli workout set clear [exercise] --workout-id <evt_id> --set-order <n>`.
- Finish an early or targetless session: `vault-cli workout finish --workout-id <evt_id>`.

Saved target values remain in the workout format. A newly started session contains unlogged set coordinates, but no planned target value is copied into an actual set field. A target is not a completed set. Read the referenced routine with `vault-cli workout format show <routineId> --format json` when a card needs target labels; never copy those labels into canonical actuals.

## Required write flow

1. Resolve mutation authority from an exact canonical workout id returned by the current start/read result, the durable tracking marker on the one card being answered, or immediate causal context that already names that exact id. There is no global active or focused workout selector. Never choose a workout by recency.
2. When the exact workout id or set coordinate is genuinely unavailable, ask which workout, exercise, or set the member means. Do not block unrelated new work, demand closure metadata for another workout, or create a workout merely to make an earlier assistant claim appear true.
3. Pass `--workout-id`, one explicit exercise selector, and `--set-order` on every set mutation. Prefer a stable `--exercise-id`; otherwise use exact exercise order or the exact canonical name. Repeated attempts then converge on the same record and coordinate instead of appending or retargeting.
4. When the member states one exact repetition count for every set of one exercise, immediately persist that smallest exercise-owned fact with `workout exercise set-reps`. Later terse completions may omit `--reps`; the canonical use case copies the stored member fact into that completed set's actual `reps` field. The stored fact fills only an unlogged coordinate; a note, load, or other correction on an already logged set preserves that set's explicit repetitions unless the member supplies a new repetition result. The fact survives provider-thread loss and bounded transcript replay because it belongs to the workout exercise, not assistant memory. Only an explicit new statement that one exact count applies to every set updates the fact before logging that completion. An exact result for one set changes only that set's actual. Clear the fact only when the member withdraws the every-set instruction.
5. The fixed-repetition fact is never derived from a saved-plan target, prior workout, card target, assistant suggestion, range, AMRAP, or qualitative instruction. Ask one narrow question when the count conflicts, could apply to multiple exercises, or is not exact. Never carry forward weight, duration, distance, RPE, bodyweight, assistance, added weight, or any other actual field.
6. Complete all workout mutations requested by the current member message in order, treating each successful command result as verification. Then attach exactly one refreshed structured workout card from the final verified exact snapshot on a supported private card route. A final write that closes a finite workout remains card-eligible as that just-finished workout. Do not attach an intermediate card or add companion prose.
7. Logging the last pending set of an explicitly finite workout closes that exact workout in the same canonical write. The accepted set completion time is the observed end boundary; do not issue a ceremonial independent finish command.
8. Use `workout finish` only for explicit early closure or a targetless session. It records `endedAt` and duration but never invents missing set values. A later explicit extra set remains valid when it names that completed workout and exact exercise/set; the successful write moves that workout's observed end boundary to the extra completion.

A bare acknowledgement such as “ok,” “yes,” or “got it” is not a set completion. Keep the last exact coordinate the member identified. If that coordinate still needs an actual result, ask one narrow question; if it already matches, make no workout mutation. Never advance to another set from an acknowledgement.

The compound replacement path applies only to one fully specified ad-hoc
workout. A saved format or an exact-reference reminder never uses `workout
replace`; those requests retain their specialized start and exact-record flows.
An ordinary request to start a workout does not itself authorize deletion.

When the current message explicitly directs Murph to delete or replace one
named workout, or the member immediately gives an unambiguous affirmative to a
bounded proposal, read that exact workout once and retain its canonical id and
`lifecycle.revision`. The proposal names the workout that will be deleted and
repeats the replacement title, every exercise, and every stated set count.
Run exactly one `vault-cli workout replace` command with that proposal-time
`--workout-id`, proposal-time `--expected-revision`, `--confirm-delete`, and one
repeated `--exercise` specification per requested exercise.
Do not separately delete, start, or add each exercise, and do not perform another preflight read
after the immediate approval. Omit an unstated set count so that exercise gets
one targetless pending slot.

The command takes the exact workout's record-scoped lock, revalidates that the
approval-bound revision is unchanged, and atomically writes the old tombstone
plus the complete replacement. Other unfinished workouts are valid and remain
untouched. A retry after a committed write may return the existing replacement
without another write only when the canonical tombstone and replacement point
to each other and exactly match the approved revision and requested content. A
missing, completed, changed, wrong-revision, or nonmatching record fails closed.
Say that nothing was replaced and ask a fresh bounded replacement question from
a new exact read. Treat a successful or proven replay result as the verification
result and return its refreshed workout card.

## Scheduled reminder relationship context

A scheduled reminder and its later ordinary private-chat follow-up may carry host-preserved `automationId`, occurrence timestamps, `supportSeriesId`, and exact `contextReferences`. Preservation proves only which ids were stored with the delivered reminder. References are routing and interpretation context, not read or write authority, and native iMessage Reply is not required.

When saving or patching a reminder for a saved workout, resolve the routine with a successful current `vault-cli workout format show <lookup> --format json` read or format-creation result, then copy its returned id into `contextReferences: [{ "entityKind": "workout_format", "entityId": "<exact_format_id>" }]`. If current evidence does not identify exactly one format, save no reference. On a later completion, inspect that exact format before relying on it. Never synthesize the id from reminder text, title, card state, or recency.

An exact `workout_format` reference can authorize starting that routine when the member's current message clearly requests or completes one of its sets. Run `workout start --routine <exact_format_id>`, preserve the returned workout id, and apply only the stated set to that new exact record. An older unfinished workout neither blocks this start nor needs to be closed first. The reminder does not establish any older workout's end time, and Murph never derives one from `durationMinutes`, a reminder time, a later reply, local midnight, plan targets, or last-write time.

When immediate causal context instead names an existing exact workout id, exact-read it with `vault-cli workout show <evt_id> --format json` and mutate only that record. If the message and relationship context do not identify one exact workout and coordinate, ask which one is intended. Missing, completed, or changed coordinates fail closed without retargeting; a completed exact workout may still accept a clearly requested extra set.

Explicit historical intent remains explicit targeting. A correction naming yesterday, an older date, an older workout id, or an older card updates only that exact historical event; reminder context never redirects it to a different routine or closes another workout as a side effect.

The legacy `workout edit` full-structure replacement remains available only for a deliberate identity-preserving structural operation that the targeted surface cannot express, such as a reorder, addition, or coordinated field edit. Read the complete record first and preserve every unrequested field. Keep an existing `sourceExerciseId` on that same exercise; without one, keep its exact canonical name. Presentation order never proves exercise identity. The CLI refuses a structured replacement that omits, ambiguously matches, or semantically replaces a saved exercise or omits a saved set. Use `--clear-workout` only when the member explicitly wants to remove all structured workout details while preserving the event, and use `vault-cli workout delete <evt_id>` only when they want to remove the entire record.

## Starting a workout

1. Resolve the requested saved format when the member names one. If there is no reusable plan, start a clearly requested empty session and preserve every distinct exercise the member named, including closely related variations; never collapse or omit one.
2. Run `vault-cli workout start`, passing `--routine` for a saved format. Starting a new workout is independent of every older unfinished workout and never infers or writes an end for another record.
3. Preserve the returned canonical event id and pass it to every later mutation. Use exactly a stated set count with `workout exercise add --sets`; that count is finite. When no count is stated, omit `--sets` to create one targetless unlogged slot, not a claimed plan or completed set.
4. If the member assigns one exact repetition count to every set of an exercise, persist it immediately with `workout exercise set-reps` on the returned workout id.
5. Treat each successful command result as verification. Read the format separately before presenting planned targets.

Never use `workout format log` to start a live workout. That command records a completed workout from a format; a live session keeps targets in the format and actual performance in the event.

## iMessage card commands

Commands inserted by an iMessage card use explicit one-based presentation coordinates:

- `Log workout exercise 2 set 1: ...`
- `Correct workout exercise 2 set 1: ...`
- `Finish this tracked workout.`

The durable transcript marker—not the inserted sentence or native URL—owns the canonical event id and snapshot instant. Resolve exactly that card's marker. If multiple cards are plausible or the marker is missing, ask which workout rather than choosing the newest record.

Then:

1. Read the exact event with `vault-cli workout show <evt_id> --format json`. A missing or mismatched event fails closed instead of falling through to another workout.
2. For Finish, run `vault-cli workout finish --workout-id <evt_id>`. An already-completed return is convergence.
3. Reconcile the card's ordered exercise names and set counts against the exact canonical event. If a displayed coordinate no longer maps uniquely, fail closed. An old card never authorizes overwriting a newer actual.
4. Map presentation positions to canonical exercise and set `order` values; saved formats may use sparse orders. Use `workout set log ... --workout-id <evt_id> --exercise-order <exercise-order> --set-order <set-order> --require-existing-set` for a card log or correction, passing only member-stated actuals. Use the same selectors for `workout set clear`.
5. Persist qualitative annotations such as spotted reps on that exact set's canonical `note`.
6. Treat the successful targeted command result as verification and send the refreshed immutable card.

An exact replay converges on the same coordinate and never appends a duplicate. A clearly requested extra set may append only when the message names the exact workout and exercise/set coordinate; that path may extend a completed finite workout. If a later command conflicts with an existing actual and does not clearly request a correction, ask one narrow question.

## Interpretation rules

- “Bench 185 for 8” may log the next unlogged bench set only when immediate causal context identifies one exact workout and one bench exercise.
- “Same weight, 6” may reuse only the immediately preceding canonical set for that same exercise, and only because the member explicitly said “same.”
- “The next set was 8 reps” may target the clearly current exercise only when the exact workout id remains causal. If more than one workout or exercise is plausible, ask one narrow disambiguating question.
- Never infer weight, repetitions, effort, assistance, rest, or failure from a plan, prior workout, elapsed time, reminder, or assistant suggestion. The only durable carry-forward is the exact member-owned `memberRepsPerSet` fact on that workout exercise.
- Treat member-defined shorthand as ambiguous until explained. Once defined as spotted repetitions, persist a plain set note such as `note=final rep spotted` or `note=final 2 reps spotted`; do not reinterpret it as assisted-load data.
- Persist every qualitative annotation on that exact set's canonical `note`. Never leave meaningful notation only in conversation text, an exercise summary, or the card snapshot.
- An isolated completion with no exact causal workout identity does not authorize choosing an unfinished workout or inventing one. Ask which workout and set is intended.

## Finishing

The canonical set-log owner closes an explicitly finite workout when the accepted write completes its final pending planned set. That same atomic write records the actual result, `endedAt`, and final duration using the accepted completion as the observed end boundary. Do not require independent “I am done” language and do not call `workout finish` afterward merely for ceremony.

Run `vault-cli workout finish --workout-id <evt_id>` only for explicit early closure or a targetless session. When one message contains both an unfinished set result and early closure intent, log that exact set first and then finish the same exact workout. Never derive an older end from a reminder, midnight, stored duration, last-write time, or plan target.

A later clearly requested extra set may be logged against the completed workout's exact id. The accepted extra-set write becomes the new observed end boundary for that workout; the system does not keep all completed workouts globally active in anticipation of this rarer path.

For completed presentation, every planned set without an actual becomes `skipped`. A targetless log slot that remains empty also becomes `skipped` with `target=null`; this preserves structure without turning the slot into a plan or actual performance.

## Building a structured workout card

Use `murph.attach_response_card` with `kind="compact_table"` and structured `workout` detail in a private direct conversation when a verified live or just-finished workout is the primary answer.

Build it from the verified canonical workout event and, when present, its verified workout format:

- `target`: the matching planned set from the verified format, otherwise `null`;
- `actual` and targetless log-slot coordinates: the verified canonical event.

Do not add `rowHeader`, `columns`, or `rows` to a structured workout card. Text, provider-layout, and native-envelope consumers derive progress directly from `workout.exercises`. Map each planned set in `workout.exercises` to:

- `pending`: no corresponding actual result and the workout is still live;
- `completed`: a corresponding actual result exists;
- `skipped`: no corresponding actual result and the workout has ended.

Also include every canonical event set with no matching format set. Use `target=null`; mark it `completed` when an actual result exists, `pending` while the workout is live and the slot is empty, or `skipped` after the workout ends and the slot remains empty. An empty targetless slot is a verified logging coordinate, not evidence of a planned set. Preserve canonical exercise and set order. Build and attach the complete verified card without estimating its encoded size from exercise or set count. The card tool's validation of the actual encoded envelope is authoritative. Never ask the member to delete, merge, or simplify canonical workout data merely to fit the presentation.

The outer card remains `compact_table` V1. Set `workout` to:

```json
{
  "version": 1,
  "state": "active",
  "exercises": [
    {
      "name": "Bench press",
      "sets": [
        {
          "status": "pending",
          "target": "185 lb × 6–8",
          "actual": null
        }
      ]
    }
  ]
}
```

Use `state="completed"` only after replacing every remaining `pending` set with `skipped`. A completed set always carries `actual`; pending and skipped sets never do.

Set the outer `subtitle` to `null`. Workout state and progress are derived from
the structured sets, so do not author a second state or progress label there.

The footer is shared verbatim by the interactive native card and the static
fallback. Keep it channel-neutral: never tell the member to tap an exercise or
use another control that is unavailable on macOS or without the extension.
When continuation guidance is useful, tell them to reply with the exercise,
set, and result.

Set `tracking` to `{ "kind": "workout", "entityId": "<exact evt id>", "snapshotAt": "<canonical verified UTC instant>" }`. The backend keeps tracking in durable transcript text and strips it from the native URL.

## Card refresh behavior

- After successfully starting or resuming one canonical live workout, use one verified structured workout card as the complete response on a supported private card route. Do not send a text-only start acknowledgement or wait for a separate card request.
- Fall back to truthful ordinary text only when the card tool is unavailable, the canonical event cannot be verified, any claimed planned targets cannot be verified from their matching format, the card would not completely answer the turn, or the complete card is rejected by the card tool's actual encoded-envelope validation. Do not preempt that validation from an estimated exercise or set count, and do not ask the member to change the saved workout to make a card fit.
- After completing all ordinary free-form workout mutations requested by the current message, send one refreshed card from the final verified snapshot; do not also repeat the update in prose.
- After an accepted explicit card command, send the refreshed card as the response; do not also repeat the full workout in prose.
- Do not send proactive cards without an existing authorized reminder or automation.
- When a request does not materially change canonical workout state, do not emit a duplicate snapshot solely to acknowledge the no-op.

## Generic and legacy compact tables

Use an ordinary `compact_table` when the member explicitly asks for a table, when a table alone completely answers a non-live-workout request, or when a historical workout does not need the structured drill-down surface.

- Use one flexible row-label column plus one to four compact value columns, with at most eight rows.
- Prefer short human labels. Do not add columns merely because the schema permits them.
- Never emit Markdown-table syntax on a messaging route.
- A compact table cannot be combined with response media or a second response card.
- Keep `tracking` null for a one-off table that is not backed by canonical state.
- For a canonical workout snapshot, set the exact workout tracking marker only after re-reading the event.

A message such as “show the workout table” or an update whose durable tracking marker or immediate causal context identifies one exact workout receives a refreshed snapshot on a supported private card route. Without that exact identity, do not choose a workout by recency or invent one from an update-like message; ask one narrow disambiguating question.

When an exercise has one to four logged or planned sets and the member asks for a simple table, use the natural set-by-set shape:

- row header: `Exercise`;
- columns: `Set 1`, `Set 2`, `Set 3`, and `Set 4` as needed;
- one row per exercise, preserving canonical exercise order;
- each completed cell: the concise load/reps value plus any verified set note, such as `45 × 6 (final rep spotted)`;
- each unlogged placeholder: an em dash or equally clear empty-state marker.

Preserve all available set columns and set notes. Do not collapse or discard the fourth set merely to fit a dense grid; the native reader has a stacked four-set presentation. If any exercise has more than four sets, do not silently truncate it. Use a compact summary such as `Exercise | Completed | Latest | Notes`, or readable plain text when the full history is the point.

For a compact-table workout that predates structured `workout` detail, accept an update only when its durable tracking marker or immediate causal context identifies one exact canonical event and coordinate. Before every mutation, re-read that event, use the targeted commands, and preserve all unrelated state. Persist annotations on the canonical set note, including `note=final rep spotted` or `note=final 2 reps spotted`. Never leave meaningful notation only in conversation text, an exercise summary, or a presentation snapshot.

## Fallback

Use readable text when explanation is necessary, the native card is not supported on the route, or the presentation would exceed its bounds. Never claim a write succeeded until the canonical command result proves it.

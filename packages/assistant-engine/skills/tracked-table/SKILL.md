---
name: tracked-table
description: Use when a private Murph member asks to start or update a live workout, log or correct sets, finish a workout, show a workout table, create a structured tracker, use a native workout card, or refresh a tracked table. Owns canonical live-workout mutations and compact native table presentation.
---

# Tracked workout and table

## Goal

Make workout logging easier than opening a dedicated tracker while keeping one canonical workout record that the member can inspect for months. Text is the write interface; a compact table is an immutable presentation snapshot.

A tracked `compact_table` may add structured `workout` detail for one active or just-finished strength workout. An ordinary `compact_table` remains the right surface for arbitrary tables, historical comparisons, or tracked data that is not one live workout.

## Core invariant

A saved workout format owns the plan: ordered exercises, stable `sourceExerciseId` values, planned sets, and target values. One canonical `activity_session` workout event owns what actually happened: session timing, ordered exercises, completed set values, notes, and the routine reference.

The canonical event is the only mutable authority. Never create a parallel tracker file, table document, memory record, database row, mutable card record, or app-only workout state. Cards are immutable presentation snapshots. The Messages extension is offline and unauthenticated; its controls only insert visible commands into the current composer, and the member still sends the message. Only the normal Murph message path may mutate canonical workout state.

A prior bubble never changes in place. Updating a workout means mutating the canonical event through the guarded command surface, verifying the result, and, when canonical state changes, sending a new snapshot on a supported private card route. The native URL must not contain the canonical event id, member identity, credentials, or write authority.

For ordinary live logging, use the targeted workout commands below. Do not reconstruct and replace the complete nested exercise/set array in model-authored shell arguments. The targeted commands read, preserve, validate, and rewrite the complete canonical structure inside the workout use-case boundary.

## Live workout command surface

- Start: `vault-cli workout start [name]` with optional `--routine <format lookup>`.
- Resolve: `vault-cli workout active` or `vault-cli workout active --workout-id <evt_id>`.
- Add an exercise: `vault-cli workout exercise add <name> --order <n> [--sets <n>]`.
- Log or correct a set: `vault-cli workout set log [exercise]`.
- Undo one set without shifting later set numbers: `vault-cli workout set clear [exercise] --set-order <n>`.
- Finish: `vault-cli workout finish`.

Saved target values remain in the workout format. A newly started session contains unlogged set placeholders with stable coordinates, but no planned target value is copied into an actual set field.

A target is not a completed set. When a table needs planned targets, read the referenced routine with `vault-cli workout format show <routineId> --format json` and label those values as targets. Never copy planned targets into actual set fields or claim that they were completed.

## Required write flow

1. Before a mutation, run `vault-cli workout active --format json`. Reuse the exact canonical `evt_<ULID>` returned by that read. If no live workout exists, do not create one from a completion, correction, or acknowledgement alone. Start one only when the current message explicitly requests a new workout or the member accepts the exact bounded recovery offer below.
2. After resolving, pass `--workout-id` on every live-workout mutation, including exercise additions and finish. For every set write, pass `--workout-id`, one explicit exercise selector, and `--set-order`. Prefer a stable `--exercise-id`; otherwise use exact exercise order or the exact canonical name. This makes a repeated agent attempt correct the same set rather than append a duplicate.
3. Pass only actual values the member stated with the completion or values already present on that exact canonical set. The sole carry-forward exception is one exact repetition count the member explicitly applied to every set of one exercise. That repetition count remains member-stated for those set coordinates only while the same workout is active and its establishing message remains available in the current direct conversation. For a later unqualified completion such as “set 2 done,” pass only `--reps` with that count instead of asking again or writing a note-only completion. Do not carry forward weight, duration, distance, RPE, bodyweight, assistance, added weight, or any other actual field; each must be stated with that completion or already exist on that exact canonical set. A repetition count stated with the completion overrides the earlier count. Ask for the repetitions when the earlier repetition prescription is a range, AMRAP or qualitative instruction, conflicts with another count, could apply to more than one exercise, or is no longer available in the current conversation. Never treat a saved-plan target, prior workout, card target, or assistant-authored suggestion as this repetition prescription. Preserve stated units and wording.
4. Treat the successful command result as the verification read. Acknowledge only what that returned record proves.
5. After every verified private workout mutation that changes the snapshot—including an ordinary set log, correction, clear, exercise addition, start, resume, or finish—build and attach the refreshed structured workout card as the complete response on a supported private card route. Do not send a text-only acknowledgement or companion prose.
6. Use `workout set log` again to correct a set. Use `workout set clear` for “undo that set,” “I didn’t do it,” or an accidental log. Clearing preserves the placeholder and later set numbering.
7. Finish only when the member explicitly says they are done, asks to finish, or unmistakably closes the session. `workout finish` records `endedAt` and final elapsed duration; it does not invent missing set values.

A bare acknowledgement such as “ok,” “yes,” or “got it” is not a set completion. Keep the last set coordinate the member explicitly identified. If that exact coordinate still needs an actual result, ask one narrow question about it. If its canonical result already matches, treat the acknowledgement as a conversation-only no-op; never advance to another set from that acknowledgement. The sole exception is a contextual affirmative that directly accepts the exact bounded missing-workout recovery offer below.

If `workout active` returns no event during a completion request, correction request, or acknowledgement follow-up, fail closed. Do not start a workout to reconcile a prior assistant claim or confirmation. Do not mutate workout state, and do not claim that any set was saved. On this missing-workout turn, first say that no active tracked workout exists and that the set was not saved. When the member already provided one exact exercise, set number, and result, the same response must then ask one bounded recovery question that repeats the complete proposed action: start a new workout with that exercise, create only enough pending set coordinates through the named set with `workout exercise add --sets`, and log only the named set with the stated result. Use the shape “Start a new workout with <exercise>, create sets 1 through <set>, and log only set <set> as <result>?” Do not stop after the no-active statement or replace the exact question with generic retry advice. Otherwise ask only for the missing detail. A contextual affirmative answer to that exact offer authorizes only the proposed start and exact set write; it is not a new completion and cannot advance another set. Re-run `workout active` before acting on the answer. If an active workout now exists, do not retarget the accepted recovery; explain that the workout state changed and ask before writing.

## Scheduled reminder relationship context

A scheduled reminder and its later ordinary private-chat follow-up may carry trusted host-supplied `automationId`, occurrence timestamps, `supportSeriesId`, and exact `contextReferences`. The references are routing and interpretation context only. They do not grant permission to read or mutate a record, do not replace normal tool checks, and do not require native iMessage Reply. Use the same context when the member sends the next ordinary direct message after the reminder.

When saving or patching a reminder for a saved workout, set `contextReferences: [{ "entityKind": "workout_format", "entityId": "<exact_format_id>" }]`. When consuming that reminder or its later ordinary reply context, require that one exact `workout_format` reference and inspect the saved routine with `vault-cli workout format show <exact_format_id> --format json` before relying on it. Never hide, translate, or infer the id from reminder text, a title, a prior card, or conversational recency. A previous-day active workout is not automatically the target merely because it remains open.

When an ordinary private-chat set completion clearly targets the referenced saved routine on a later member-local calendar day, compose only the existing lifecycle owners:

1. Run `vault-cli workout active --format json`. Continue only when exactly one active workout exists and the referenced routine, exercise, set coordinate, and member-stated actual result are all unambiguous.
2. Resolve calendar days in the vault or member IANA timezone. Never compare UTC date strings or ISO date prefixes as a local-day proxy. Same-local-day state, missing or conflicting references, multiple active workouts, and an unidentified new routine fail closed.
3. If the sole active workout began on an earlier local day and is a different routine, preserve its exact canonical event. Derive an explicit close instant only from existing canonical timing evidence, such as its canonical `startedAt` plus stored elapsed `durationMinutes`, then run `vault-cli workout finish --workout-id <earlier_evt_id> --ended-at <canonical_end_instant>`. Never finish at the later reply time, reminder time, or local midnight. If canonical timing evidence is missing or inconsistent, stop without mutation.
4. Verify that every logged result remains unchanged and every unlogged placeholder remains empty. Never copy format targets into actual fields.
5. Run `vault-cli workout start --routine <exact_format_id>`, retain the newly returned workout id, then run `vault-cli workout set log ... --workout-id <new_evt_id> --set-order <exact_order> --require-existing-set` with an exact exercise selector and only the actual values stated by the member.

The existing one-active-workout invariant and live-workout mutation lock remain authoritative for every command. These are ordinary reads and writes, not a composite command or reply capability. If any step observes changed or ambiguous state, stop rather than reopening, rolling back, or retargeting another workout.

Explicit historical intent remains explicit targeting. A correction naming yesterday, an older date, an older workout id, or an older card should inspect and update that historical event through the existing exact-id path; reminder context never redirects it to a new routine or closes another workout as a side effect.

The legacy `workout edit` full-structure replacement remains available only for a deliberate structural operation that the targeted surface cannot express, such as a requested reorder or full routine rewrite. Read the complete record first and preserve every unrequested field. The CLI refuses a structured replacement that omits a saved exercise or set. Use `--clear-workout` only when the member explicitly wants to remove all structured workout details while preserving the event, and use `vault-cli workout delete <evt_id>` only when they want to remove the entire record.

## Starting a workout

1. Resolve the requested saved format when the member named one. If there is no reusable plan, start a clearly requested empty session and preserve every distinct exercise the member named, including closely related variations; never collapse one variation into another or silently omit an item. Use exactly a stated set count. When an exercise has no stated count, create one unlogged targetless placeholder as the next log slot, not as a claimed plan or completed set.
2. Ensure no second private live workout is plausible. Reuse the clearly active event or ask one narrow question rather than creating a duplicate.
3. Run `vault-cli workout start`, passing `--routine` when using a saved format. The command must preserve plan ownership in the format and start every planned set as an unlogged placeholder containing only canonical event coordinates and actual-state fields.
4. Treat the returned canonical event as the verified start result. Read the format separately before presenting planned targets.

Never use `workout format log` to start a live workout. That command records a completed workout from a format; a live session deliberately keeps targets in the format and actual performance in the event.

## iMessage card commands

Commands inserted by the iMessage card use explicit one-based coordinates:

- `Log workout exercise 2 set 1: ...`
- `Correct workout exercise 2 set 1: ...`
- `Finish this tracked workout.`

The numbers in those sentences are presentation positions, not canonical `exercise.order` or `set.order` values. Resolve them only against the single unambiguous tracked workout card in the same private conversation. Prefer the latest verified snapshot only when it is the sole plausible session. The inserted text carries no record authority. If multiple tracked cards or events are plausible—or a command from an older completed card could otherwise land on a different active workout—ask one narrow question instead of choosing by recency alone. The durable transcript marker contains the canonical event id and snapshot instant; the native URL does not.

Then:

1. Resolve the exact canonical event from the sole plausible durable card marker. A missing or mismatched event fails closed instead of falling through to another live workout.
2. For Finish, run `vault-cli workout finish --workout-id <evt_id>` directly. The explicit command is replay-safe: an already-completed return is convergence, not failure. Verify that returned event and build the completed card, including skipped planned sets, even when the first reply or card delivery failed after persistence.
3. For a set log, correction, or clear, run `vault-cli workout active --workout-id <evt_id> --format json`. A completed or stale workout fails closed.
4. Reconcile the card's ordered exercise names and set counts against the latest canonical event. If the displayed exercise no longer maps to exactly one canonical exercise, or its displayed set position no longer exists, fail closed. An old card never authorizes overwriting newer actual values.
5. Map the displayed exercise and set positions to that exercise's current canonical `order` values. Do not pass the display numbers through as canonical orders; saved formats may use sparse orders. Use `vault-cli workout set log '<displayed-exercise-name>' --workout-id <evt_id> --exercise-order <canonical-order> --set-order <canonical-order> --require-existing-set` for a card log or correction, passing only member-stated actual values. The exact displayed name and mapped order must both match. Use the same mapped selectors for `workout set clear`.
6. Persist qualitative annotations such as spotted reps on that exact set's canonical `note`.
7. Treat the successful targeted command result as the verification read. Only that returned record proves the update.
8. Send a refreshed immutable structured workout card from the verified event plus verified format.

An exact replay for the same exercise and set coordinate converges on that coordinate and never appends a duplicate. Card actions always require the mapped set to exist; ordinary free-form logging may still append a deliberately requested new set. If the coordinate already has the same actual result, report the saved state. If a later command conflicts with it and does not clearly request a correction, ask one narrow question.

## Interpretation rules

- “Bench 185 for 8” may log the next unlogged bench set only when one live workout and one bench exercise are unambiguous.
- “Same weight, 6” may reuse only the immediately preceding canonical set for that same exercise, and only because the member explicitly said “same.”
- “The next set was 8 reps” may target the clearly current exercise. If two exercises are plausible, ask one narrow disambiguating question.
- Never infer weight, repetitions, effort, assistance, completion, rest, or failure from a plan, prior workout, elapsed time, or a reminder.
- Treat member-defined shorthand as ambiguous until explained. Once defined as spotted repetitions, persist a plain set note such as `note=final rep spotted` or `note=final 2 reps spotted`; do not reinterpret it as assisted-load data.
- Persist every qualitative annotation on that exact set's canonical `note`. Never leave meaningful notation only in conversation text, an exercise-level summary, or the card snapshot.
- If no active workout exists, do not treat an isolated “8 reps” message as authorization to invent one.

## Finishing

Run `vault-cli workout finish --workout-id <evt_id>` only after an explicit finish. The returned event must contain the verified `endedAt` and final elapsed duration. Do not fabricate missing set values or copy targets into the event.

For the completed presentation, every planned set without a corresponding actual result becomes `skipped` rather than disappearing. A canonical targetless log slot that remains empty when the session ends also becomes `skipped` with `target=null`; that preserves the verified session structure without turning the slot into evidence of a plan or actual performance.

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
- After every verified ordinary free-form set log, correction, clear, or exercise addition, send the refreshed card as the response; do not also repeat the update in prose.
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

A message such as “show the workout table” or an unambiguous update to the single active tracked workout whose table was explicitly established earlier receives a refreshed snapshot on a supported private card route. With no active tracked table, do not invent one from an update-like message. If two workouts are plausible, ask one narrow disambiguating question.

When an exercise has one to four logged or planned sets and the member asks for a simple table, use the natural set-by-set shape:

- row header: `Exercise`;
- columns: `Set 1`, `Set 2`, `Set 3`, and `Set 4` as needed;
- one row per exercise, preserving canonical exercise order;
- each completed cell: the concise load/reps value plus any verified set note, such as `45 × 6 (final rep spotted)`;
- each unlogged placeholder: an em dash or equally clear empty-state marker.

Preserve all available set columns and set notes. Do not collapse or discard the fourth set merely to fit a dense grid; the native reader has a stacked four-set presentation. If any exercise has more than four sets, do not silently truncate it. Use a compact summary such as `Exercise | Completed | Latest | Notes`, or readable plain text when the full history is the point.

For a compact-table workout that predates structured `workout` detail, accept an update only for the single active tracked workout whose table was explicitly established earlier. Before every mutation, re-read the canonical event, use the targeted commands, and preserve all unrelated state. Persist annotations on the canonical set note, including `note=final rep spotted` or `note=final 2 reps spotted`. Never leave meaningful notation only in conversation text, an exercise summary, or a presentation snapshot.

## Fallback

Use readable text when explanation is necessary, the native card is not supported on the route, or the presentation would exceed its bounds. Never claim a write succeeded until the canonical command result proves it.

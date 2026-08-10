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

A prior bubble never changes in place. Updating a workout means mutating the canonical event through the guarded command surface, verifying the result, and optionally sending a new snapshot. The native URL must not contain the canonical event id, member identity, credentials, or write authority.

For ordinary live logging, use the targeted workout commands below. Do not reconstruct and replace the complete nested exercise/set array in model-authored shell arguments. The targeted commands read, preserve, validate, and rewrite the complete canonical structure inside the workout use-case boundary.

## Live workout command surface

- Start: `vault-cli workout start [name]` with optional `--routine <format lookup>`.
- Resolve: `vault-cli workout active` or `vault-cli workout active --workout-id <evt_id>`.
- Add an exercise: `vault-cli workout exercise add <name> --order <n>`.
- Log or correct a set: `vault-cli workout set log [exercise]`.
- Undo one set without shifting later set numbers: `vault-cli workout set clear [exercise] --set-order <n>`.
- Finish: `vault-cli workout finish`.

Saved target values remain in the workout format. A newly started session contains unlogged set placeholders with stable coordinates, but no planned target value is copied into an actual set field.

A target is not a completed set. When a table needs planned targets, read the referenced routine with `vault-cli workout format show <routineId> --format json` and label those values as targets. Never copy planned targets into actual set fields or claim that they were completed.

## Required write flow

1. Before a mutation, run `vault-cli workout active --format json`. Reuse the exact canonical `evt_<ULID>` returned by that read. If no live workout exists, start one only when the member asked to start or clearly began a workout.
2. After resolving, pass `--workout-id` on every live-workout mutation, including exercise additions and finish. For every set write, pass `--workout-id`, one explicit exercise selector, and `--set-order`. Prefer a stable `--exercise-id`; otherwise use exact exercise order or the exact canonical name. This makes a repeated agent attempt correct the same set rather than append a duplicate.
3. Pass only values the member stated or values already present on that exact canonical set. Preserve their units and wording.
4. Treat the successful command result as the verification read. Acknowledge only what that returned record proves.
5. For ordinary free-form gym logging, keep acknowledgements tiny: exercise, set number, and the persisted load, reps, time, or note. Do not send a fresh table card after every ordinary set update.
6. Use `workout set log` again to correct a set. Use `workout set clear` for “undo that set,” “I didn’t do it,” or an accidental log. Clearing preserves the placeholder and later set numbering.
7. Finish only when the member explicitly says they are done, asks to finish, or unmistakably closes the session. `workout finish` records `endedAt` and final elapsed duration; it does not invent missing set values.

The legacy `workout edit` full-structure replacement remains available only for a deliberate structural operation that the targeted surface cannot express, such as a requested reorder or full routine rewrite. Read the complete record first and preserve every unrequested field. The CLI refuses a structured replacement that omits a saved exercise or set. Use `--clear-workout` only when the member explicitly wants to remove all structured workout details while preserving the event, and use `vault-cli workout delete <evt_id>` only when they want to remove the entire record.

## Starting a workout

1. Resolve the requested saved format when the member named one. If there is no reusable plan, start a clearly requested empty session and add only the exercises and set counts the member actually specified.
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
- Persist every qualitative annotation on that set's canonical `note`. Never leave meaningful notation only in conversation text, an exercise-level summary, or the card snapshot.
- If no active workout exists, do not treat an isolated “8 reps” message as authorization to invent one.

## Finishing

Run `vault-cli workout finish --workout-id <evt_id>` only after an explicit finish. The returned event must contain the verified `endedAt` and final elapsed duration. Do not fabricate missing set values or copy targets into the event.

For the completed presentation, every planned set without a corresponding actual result becomes `skipped` rather than disappearing. That is an explicit card status derived from the ended event plus the format; it is not invented actual performance.

## Building a structured workout card

Use `murph.attach_response_card` with `kind="compact_table"` and structured `workout` detail in a private direct conversation when a verified live or just-finished workout is the primary answer.

Build it from two canonical sources:

- `target`: the matching planned set from the verified workout format;
- `actual`: the matching completed set from the verified canonical workout event.

Set the compact summary to `rowHeader="Exercise"`, `columns=["Progress"]`, and one row per exercise whose value is `<completed>/<total>`. Then map each planned set in `workout.exercises` to:

- `pending`: no corresponding actual result and the workout is still live;
- `completed`: a corresponding actual result exists;
- `skipped`: no corresponding actual result and the workout has ended.

If the event contains additional actual sets beyond the format, include them as completed sets with `target=null`. Preserve canonical exercise and set order. Keep the card within its exercise, set, text, and encoded URL limits; use a compact table or readable text when the full workout cannot fit.

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

Set `tracking` to `{ "kind": "workout", "entityId": "<exact evt id>", "snapshotAt": "<canonical verified UTC instant>" }`. The backend keeps tracking in durable transcript text and strips it from the native URL.

## Card refresh behavior

- Send one structured workout card when the workout starts and the planned session is useful.
- After an accepted explicit card command, send the refreshed card as the response; do not also repeat the full workout in prose.
- For ordinary free-form logging, prefer concise text until a meaningful milestone, an explicit table request, or Finish.
- Do not send proactive cards without an existing authorized reminder or automation.
- For a simple acknowledgement that does not materially change the workout, prefer concise text rather than another card.

## Generic and legacy compact tables

Use an ordinary `compact_table` when the member explicitly asks for a table, when a table alone completely answers a non-live-workout request, or when a historical workout does not need the structured drill-down surface.

- Use one flexible row-label column plus one to four compact value columns, with at most eight rows.
- Prefer short human labels. Do not add columns merely because the schema permits them.
- Never emit Markdown-table syntax on a messaging route.
- A compact table cannot be combined with response media or a second response card.
- Keep `tracking` null for a one-off table that is not backed by canonical state.
- For a canonical workout snapshot, set the exact workout tracking marker only after re-reading the event.

A message such as “show the workout table” or an unambiguous update to the single active tracked workout whose table was explicitly established earlier can receive a refreshed snapshot. With no active tracked table, do not invent one from an update-like message. If two workouts are plausible, ask one narrow disambiguating question.

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

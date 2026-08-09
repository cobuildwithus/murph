---
name: tracked-table
description: Use when a private Murph member asks for a table, workout table, structured tracker, live workout log, native workout card, or an updated/refreshed card. Covers canonical workout-backed set logging, structured workout detail on compact tables, and generic compact tables.
---

# Tracked tables and live workouts

## Goal

Give the member a complete strength-workout experience through ordinary messages and a readable native iMessage card without making the message or extension a second data store.

Use:

- a tracked `compact_table` with structured `workout` detail for one active or just-finished strength workout with exercises, targets, and set completion;
- an ordinary `compact_table` for arbitrary tables, historical comparisons, or tracked data that is not one live workout.

## Core invariant

Cards are immutable presentation snapshots, never authority. The Messages extension is offline and unauthenticated. Its workout controls insert explicit commands into the current Messages composer; the member still sends the message. Only the normal Murph message path may mutate canonical workout state.

A prior bubble never changes in place. “Update the workout” means update canonical state, verify it, and send a new snapshot. The existing `compact_table` response-card kind remains the stable authoring surface; structured workout detail upgrades only its native presentation.

## Canonical workout ownership

Reuse the existing workout primitives:

- A saved workout format owns the plan: ordered exercises, stable `sourceExerciseId` values, planned sets, and target values.
- One canonical `activity_session` workout event owns what actually happened: `startedAt`, optional `endedAt`, ordered exercises, completed sets, notes, and the routine reference.
- A live workout is an event with `workout.startedAt` and no `workout.endedAt`.
- A finished workout has `workout.endedAt`.
- The durable transcript may retain the exact tracked workout id for later turns, but the native card URL must not contain it.

Do not create a parallel tracker document, mutable card record, memory row, or app-only workout state.

## Starting a workout

1. Resolve the requested workout format. If the member has no reusable plan, help them create one before starting when the intended exercises or targets are known.
2. Ensure no second private live workout is plausible. Reuse the clearly active event or ask one narrow question rather than creating duplicates.
3. Create one structured workout event through the existing workout command surface:
   - copy exercise names, order, groups, mode, units, and `sourceExerciseId` from the format;
   - set `routineId`, `routineName`, and `startedAt`;
   - start every exercise with an empty actual `sets` array;
   - use the format's expected duration only as the event's required planned duration, not as proof of elapsed time.
4. Re-read the event and format before presenting the workout.

Never use `workout format log` to start a live workout. That command records a completed workout from a format; a live session deliberately stores targets in the format and actual completed sets in the event.

## Logging and correcting sets

Commands inserted by the iMessage card use explicit one-based coordinates:

- `Log workout exercise 2 set 1: ...`
- `Complete workout exercise 2 set 1 at its shown target.`
- `Correct workout exercise 2 set 1: ...`
- `Finish this tracked workout.`

Resolve those coordinates against the latest tracked workout card in the same private conversation. Its durable transcript marker contains the canonical event id and snapshot instant.

Then:

1. Run `vault-cli workout show <evt_id> --format json`.
2. Read the referenced workout format when the command depends on a shown target.
3. Reconcile against the latest canonical event. An old card never authorizes overwriting newer sets.
4. Append or correct only the requested actual set while preserving every unrelated exercise, set, unit, note, source id, and field.
5. Persist qualitative annotations such as spotted reps on that exact set's canonical `note`.
6. Apply the complete intended replacement through `vault-cli workout edit` because nested workout arrays use replacement semantics.
7. Re-read the event. Only the successful re-read proves the update.
8. Send a refreshed immutable workout card from the verified event plus verified format.

A repeated command for the same exercise and set coordinate should converge on that coordinate, not append a duplicate. If the coordinate is already complete and the member did not clearly request a correction, state what is saved and ask one narrow question.

## Interpreting normal gym messages

When one live workout is clear, understand concise follow-ups such as:

- `bench 135 for 10`
- `same weight, 8`
- `set 3 was actually 9`
- `last rep spotted`
- `done with bench`
- `finish the workout`

Use immediate exercise/set context only when it is unambiguous. Never invent weight, repetitions, assistance, effort, completion, or target values.

For a new actual set, append one set in canonical order. Targets remain in the format. A target is not a completed set until the member records it.

## Finishing

1. Re-read the event.
2. Set `workout.endedAt` to the verified finish instant.
3. Recompute elapsed duration from `startedAt` when possible and update the event duration.
4. Do not fabricate missing sets. In the completed card, planned sets without corresponding actual sets are `skipped`.
5. Re-read, then send the final workout card and a concise summary.

## Building a structured workout card

Use `murph.attach_response_card` with `kind="compact_table"` and structured `workout` detail in a private direct conversation when a verified live or just-finished workout is the primary answer.

Build it from two canonical sources:

- `target`: the matching planned set from the verified workout format;
- `actual`: the matching completed set from the verified workout event.

Set the compact summary to `rowHeader="Exercise"`, `columns=["Progress"]`, and one row per exercise whose value is `<completed>/<total>`. Then map each planned set in `workout.exercises` to:

- `pending`: no corresponding actual set and the workout is still live;
- `completed`: a corresponding actual set exists;
- `skipped`: no corresponding actual set and the workout has ended.

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

Set `tracking` to:

```json
{
  "kind": "workout",
  "entityId": "<exact evt id>",
  "snapshotAt": "<canonical verified UTC update instant>"
}
```

The backend keeps tracking in durable transcript text and strips it from the native URL.

## Card refresh behavior

- Send one workout card when the workout starts.
- After an accepted set log or correction, send the refreshed card as the response; do not also repeat the full workout in prose.
- Do not send proactive cards without an existing authorized reminder or automation.
- For a simple acknowledgement that does not materially change the workout, prefer concise text rather than another card.

## Generic compact tables

Use `murph.attach_response_card` with `kind="compact_table"` when the member explicitly asks for a table, or when a table alone completely answers a non-live-workout request.

- Use one flexible row-label column plus one to four compact value columns, with at most eight rows.
- Prefer short human labels. Do not add columns merely because the schema permits them.
- Never emit Markdown-table syntax on a messaging route.
- A compact table cannot be combined with response media or a second response card.
- Keep `tracking` null for a one-off table that is not backed by canonical state.
- For a tracked historical workout, re-read and verify the canonical event before building the table and retain the exact tracking marker in transcript context.
- If any exercise has more than four sets, do not silently truncate it. Use a compact summary shape or a readable plain-text list.

## Historical tracked-workout compatibility

For a compact-table workout that predates structured `workout` detail:

- Accept an update only for the single active tracked workout whose table was explicitly established earlier.
- With no active tracked table, do not invent one from an update-like message. If two records are plausible, ask one narrow disambiguating question.
- Before every mutation, re-read the canonical event and preserve all existing exercises and sets.
- Persist every qualitative annotation on that set's canonical `note`, for example `note=final rep spotted` or `note=final 2 reps spotted`.
- Never leave meaningful notation only in conversation text, an exercise summary, or a presentation snapshot.
- A natural four-set table uses `Set 1` through `Set 4`. Do not collapse or discard the fourth set merely to fit a denser grid.

## Fallback

Use readable text when explanation is necessary, the native card is not supported on the route, or the presentation would exceed its bounds. Never claim a write succeeded until the canonical re-read proves it.

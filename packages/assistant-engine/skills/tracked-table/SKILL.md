---
name: tracked-table
description: Use when a private Murph member asks to start or update a live workout, log or correct sets, finish a workout, show a workout table, create a structured tracker, or refresh a tracked table card. Owns canonical live-workout mutations and compact native table presentation.
---

# Tracked workout and table

## Goal

Make workout logging easier than opening a dedicated tracker while keeping one canonical workout record that the member can inspect for months. Text is the write interface; a compact table is an immutable presentation snapshot.

## Core invariant

The canonical `activity_session` workout event is the only mutable authority. Never create a parallel tracker file, table document, memory record, or database row. A card may point to one workout, but it never owns workout state and an already-sent card never changes in place.

For ordinary live logging, use the targeted workout commands below. Do not reconstruct and replace the complete nested exercise/set array in model-authored shell arguments. The targeted commands read, preserve, validate, and rewrite the complete canonical structure inside the workout use-case boundary.

## Live workout command surface

- Start: `vault-cli workout start [name]` with optional `--routine <format lookup>`.
- Resolve: `vault-cli workout active` or `vault-cli workout active --workout-id <evt_id>`.
- Add an exercise: `vault-cli workout exercise add <name> --order <n>`.
- Log or correct a set: `vault-cli workout set log [exercise]`.
- Undo one set without shifting later set numbers: `vault-cli workout set clear [exercise] --set-order <n>`.
- Finish: `vault-cli workout finish`.

A live session is still the existing canonical workout event. Saved target values remain in the workout format; a newly started session contains unlogged set placeholders until the member reports actual work.

When a table needs planned targets, read the referenced routine with `vault-cli workout format show <routineId> --format json` and label those values as targets. Never copy planned targets into actual set fields or claim that they were completed.

## Required write flow

1. Before a mutation, run `vault-cli workout active --format json`. Reuse the exact canonical `evt_<ULID>` returned by that read. If no live workout exists, start one only when the member asked to start or clearly began a workout.
2. After resolving, pass `--workout-id` on every live-workout mutation, including exercise additions and finish. For every set write, pass `--workout-id`, one explicit exercise selector, and `--set-order`. Prefer a stable `--exercise-id`; otherwise use exact exercise order or the exact canonical name. This makes a repeated agent attempt correct the same set rather than append a duplicate.
3. Pass only values the member stated or values already present on that exact canonical set. Preserve their units and wording.
4. Treat the successful command result as the verification read. Acknowledge only what that returned record proves.
5. Keep acknowledgements tiny during the session: exercise, set number, and the persisted load/reps/time or note. Do not send a fresh table card after every set.
6. Use `workout set log` again to correct a set. Use `workout set clear` for “undo that set,” “I didn’t do it,” or an accidental log. Clearing preserves the placeholder and later set numbering.
7. Finish only when the member explicitly says they are done, asks to finish, or unmistakably closes the session. `workout finish` records `endedAt` and final elapsed duration; it does not invent missing set values.

The legacy `workout edit` full-structure replacement remains available only for a deliberate structural operation that the targeted surface cannot express, such as a requested reorder or full routine rewrite. Read the complete record first and preserve every unrequested field. The CLI refuses a structured replacement that omits a saved exercise or set. Use `--clear-workout` only when the member explicitly wants to remove all structured workout details while preserving the event, and use `vault-cli workout delete <evt_id>` only when they want to remove the entire record.

## Interpretation rules

- “Bench 185 for 8” may log the next unlogged bench set only when one live workout and one bench exercise are unambiguous.
- “Same weight, 6” may reuse only the immediately preceding canonical set for that same exercise, and only because the member explicitly said “same.”
- “The next set was 8 reps” may target the clearly current exercise. If two exercises are plausible, ask one narrow disambiguating question.
- Never infer weight, repetitions, effort, assistance, completion, rest, or failure from a plan, prior workout, elapsed time, or a reminder.
- Treat member-defined shorthand as ambiguous until explained. Once defined as spotted repetitions, persist a plain set note such as `note=final rep spotted` or `note=final 2 reps spotted`; do not reinterpret it as assisted-load data.
- Persist every qualitative annotation on that set's canonical `note`. Never leave meaningful notation only in conversation text, an exercise-level summary, or the card snapshot.
- If no active workout exists, do not treat an isolated “8 reps” message as authorization to invent one.

## Presentation rules

- In a private direct conversation, use `murph.attach_response_card` with `kind="compact_table"` when the member explicitly asks for a table, at workout start when the planned session is useful, after a meaningful milestone such as completing an exercise, or at finish when the card alone completely answers the request.
- Use one flexible row-label column plus one to four compact value columns, with at most eight rows.
- Prefer short human labels. Do not add columns merely because the schema permits them.
- Never emit Markdown-table syntax on a messaging route. If a native card is not appropriate or important explanation must accompany the answer, use a readable plain-text list instead.
- A compact table cannot be combined with response media or a second response card.
- Keep `tracking` null for a one-off table that is not backed by canonical state.
- For a canonical workout snapshot, set `tracking` to `{ "kind": "workout", "entityId": "<exact evt id>", "snapshotAt": "<canonical verified UTC instant>" }`.

A message such as “show the workout table” or an unambiguous update to the single active tracked workout whose table was explicitly established earlier can receive a refreshed snapshot. With no active tracked table, do not invent one from an update-like message. If two workouts are plausible, ask one narrow disambiguating question.

## Set-by-set workout tables

When an exercise has one to four logged or planned sets and the member asks for a table, use the natural set-by-set shape:

- row header: `Exercise`
- columns: `Set 1`, `Set 2`, `Set 3`, and `Set 4` as needed
- one row per exercise, preserving canonical exercise order
- each completed cell: the concise load/reps value plus any verified set note, such as `45 × 6 (final rep spotted)`
- each unlogged placeholder: an em dash or equally clear empty-state marker

Preserve all available set columns and set notes. Do not collapse or discard the fourth set merely to fit a dense grid; the native reader has a stacked four-set presentation.

If any exercise has more than four sets, do not silently truncate it. Use a compact summary shape such as `Exercise | Completed | Latest | Notes`, or a readable plain-text list when the full set history is the actual point of the answer.

## Other useful workout shapes

Choose only fields supported by the verified record and useful right now. Common alternatives are:

- Exercise | Completed | Latest
- Exercise | Sets × reps | Load | Effort
- Exercise | Set | Reps | Weight

For a live session, favor completed or current information over a dense copy of the entire planned routine. Use the footer only for one short status or safety note that applies to the whole table.

---
name: tracked-table
description: Use when a private Murph member asks for a table, workout table, structured tracker, live workout log, or an updated/refreshed table card. Covers compact native table presentation and canonical workout-backed refreshes.
---

# Tracked table

## Goal

Give the member a readable native table without making the message itself a second data store. For a tracked workout, update the canonical workout record first and then send a new immutable table snapshot.

## Core invariant

The compact table is presentation, never authority. A tracked table may point to one canonical workout event, but it must not own or mutate workout state. The Messages extension remains read-only and network-free. “Update the table” means update the canonical record, verify it, and send a refreshed snapshot; never claim that an already-sent message changed in place.

## Presentation rules

- In a private direct conversation, use `murph.attach_response_card` with `kind="compact_table"` when the member explicitly asks for a table or asks to refresh an existing tracked table and the card alone completely answers the request.
- Use one flexible row-label column plus one to four compact value columns, with at most eight rows.
- Prefer short human labels. Do not add columns merely because the schema permits them.
- Never emit Markdown-table syntax on a messaging route. If a native card is not appropriate or important explanation must accompany the answer, use a readable plain-text list instead.
- A compact table cannot be combined with response media or a second response card.
- Keep `tracking` null for a one-off table that is not backed by canonical state.

## Tracked workout flow

1. Resolve the canonical workout event before writing. Reuse the exact `evt_<ULID>` reference from the latest tracked-table transcript when present. If it is absent or ambiguous, run a bounded `vault-cli workout list` and inspect the likely record with `vault-cli workout show`; never guess an id.
2. For a new live workout, create one canonical workout record through the existing workout command surface. Do not create a parallel table document, tracker file, memory record, or database row.
3. Before every mutation, run `vault-cli workout show <evt_id> --format json` and preserve all existing exercises and sets that the member did not ask to change.
4. Apply the member's update with `vault-cli workout edit <evt_id>`. The typed workout edit surface replaces nested exercises and sets, so send the complete intended replacement rather than only the newest set.
5. Persist every qualitative set annotation on that set's canonical `note`, for example `note=final rep spotted` or `note=final 2 reps spotted`. Never leave meaningful notation only in conversation text, an exercise-level summary, or the card snapshot.
6. Re-run `vault-cli workout show <evt_id> --format json`. Treat only this successful re-read as proof of the new state.
7. Build the compact table entirely from that verified record. Set `tracking` to `{ "kind": "workout", "entityId": "<exact evt id>", "snapshotAt": "<the canonical verified update instant, or the current canonical UTC ISO instant after the successful re-read>" }`.
8. Attach and send the refreshed card. Do not repeat the table in prose or say the prior card was edited.

## Update interpretation

- A message such as “the next set was 8 reps” or “finished set 3” is a request to update the referenced workout when the current conversation clearly owns one active tracked workout.
- Preserve the member's units, exercise order, set order, and clarified notation. Do not infer weight, repetitions, effort, completion, assistance, or rest values that were not stated or already present in the canonical record.
- Treat member-defined shorthand as ambiguous until the member explains it. Once defined as spotted repetitions, persist a plain set note such as `final rep spotted` or `final 2 reps spotted`; do not reinterpret it as assisted-load data.
- If two active or recent workouts are plausible, ask one narrow disambiguating question rather than updating both.
- “Real time” means a fresh verified snapshot after each accepted update. Recurring proactive pushes, timers, reminders, or background check-ins require their own existing authorization and owning workflow.

## Set-by-set workout tables

When an exercise has one to four logged sets and the member asks for a table, use the natural set-by-set shape:

- row header: `Exercise`
- columns: `Set 1`, `Set 2`, `Set 3`, and `Set 4` as needed
- one row per exercise, preserving the canonical exercise order
- each cell: the concise load/reps value plus any verified set note, such as `45 × 6 (final rep spotted)`

Preserve all available set columns and set notes. Do not collapse or discard the fourth set merely to fit a dense grid; the native reader has a stacked four-set presentation.

If any exercise has more than four sets, do not silently truncate it. Use a compact summary shape such as `Exercise | Completed | Latest | Notes`, or a readable plain-text list when the full set history is the actual point of the answer.

## Other useful workout shapes

Choose only fields supported by the verified record and useful right now. Common alternatives are:

- Exercise | Completed | Latest
- Exercise | Sets × reps | Load | Effort
- Exercise | Set | Reps | Weight

For a live session, favor completed or current information over a dense copy of the entire planned routine. Use the footer only for one short status or safety note that applies to the whole table.

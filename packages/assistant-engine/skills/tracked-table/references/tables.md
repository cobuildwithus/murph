# Plain tables

Read this when the member asks for a table, when a table alone answers a
request that is not a live workout, or for a workout from before workout cards
showed sets. A live or just-finished workout uses the workout card in
`tracked-table/SKILL.md`.

## A plain `compact_table`

Call `murph.attach_response_card` with `kind: "compact_table"` and `rowHeader`,
`columns` and `rows`.

- Use one label column and one to four value columns, with at most eight rows.
- Keep labels short. Add a column only when the answer needs it.
- A table cannot be combined with response media or a second card.
- Never write Markdown table syntax on a messaging route.
- Set `tracking` to null for a table that is not backed by a saved workout.
  For a saved workout, read the workout again first and then set
  `tracking` to `{ "kind": "workout", "entityId": "<exact evt id>" }`.
- When the content would not fit, reply in readable plain text.

## A workout as a simple table

When each exercise has one to four sets and the member asks for a simple table:

- Row header: `Exercise`.
- Columns: `Set 1` to `Set 4`, as many as needed.
- One row per exercise, in the saved order.
- A completed cell holds the load and repetitions plus any set note, such as
  `45 × 6 (final rep spotted)`.
- A set with no result holds a dash.

Keep every set column and every set note. If any exercise has more than four
sets, do not cut it off. Use a summary such as
`Exercise | Completed | Latest | Notes`, or plain text when the full history is
the point.

## Which workout

"Show the workout table", or an update that follows one, gets a refreshed table
only when you have the workout's exact id, as "Which workout" in
`tracked-table/SKILL.md` describes. Read the workout before building the table.
Without an exact id, ask which workout the member means.

## Workouts from before set-level cards

An older workout whose card was a plain table is updated the same way as any
other: read it, use the set and exercise commands in `tracked-table/SKILL.md`,
keep everything you were not asked to change, and save remarks about a set in
that set's note.

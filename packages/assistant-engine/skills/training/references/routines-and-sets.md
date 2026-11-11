# Workout routines and reported sets

Read this when a member asks to save, update, show or find a workout routine, or reports a set and you need to decide where it is logged. All reads and writes here happen only in the member's private conversation. In a group, acknowledge briefly and ask them to continue in their private Murph conversation.

## Three different things

A plan proposed in the conversation, a saved routine, and a live workout are separate. A title or a response card does not prove that anything was saved. When you give an unsaved plan, call it a draft and say it has not been saved.

Saving or showing a routine does not start a workout, log a set or schedule a reminder. To start, resume, update or finish a live workout, read `$MURPH_ASSISTANT_SKILLS_ROOT/tracked-table/SKILL.md`.

## Saving or updating a routine

A request to save or update a routine is the permission for that write. Do not ask again.

1. Before the first save in a conversation, run `vault-cli workout format save --help`. The exercise modes and activity types must be the exact values it lists.
2. Save with `vault-cli workout format save` using typed exercises and set templates, or `vault-cli workout format import-json` for a full structured payload. Keep the member's exact exercise order, planned sets, repetition targets, and any loads with their units. Template text in prose does not replace the structured exercise and set fields.
3. Run `vault-cli workout format show <returned-slug> --format json` and check that the saved routine matches the request.
4. Tell the member it is saved only after that check passes. If the write or the readback failed or is unclear, say what is unconfirmed, and inspect the exact record before retrying so you do not create a duplicate.

## Showing or finding a routine

Read the routine by its known id, slug or title with `vault-cli workout format show`, and present it in the conversation. Use `vault-cli workout format list --limit 20 --format json` only when you do not know which routine is meant. A limited list does not prove that no other routine exists.

If an exact read says the routine is missing, say it is not saved and show any draft from the conversation as a draft. If the read fails, say the saved state could not be checked. A question about a missing routine is not permission to save a new one.

## Where a reported set is logged

Decide the one place the set belongs before you read any other skill. Use the first row that matches the context of this turn exactly.

| What the turn context contains | Read | What to do |
|---|---|---|
| An exact live workout. It is identified by a workout command or structured card result in this turn, or by the exact `activity_session` reference the host preserved from the latest turn that made a workout decision. A later unrelated delivery that made no workout decision does not erase that reference. | `tracked-table` only | Require a current exact read of that session, or a successful change to that same session, before writing. Then log the set there. Short wording, several sets spread over a day, or the member calling it "part of my routine" never moves the set to a regimen or an experiment. |
| An exact regimen or experiment occurrence. This includes a trusted reminder whose `supportSeriesId`, exact owner reference and `plannedOccurrenceAt` identify the occurrence, even when the reminder also carries a `workout_format` reference. A daily `activity_session` is not required. | `behavior-followthrough`, plus `experiment-onboarding` for an experiment | Read the full regimen and, when there is one, the exact experiment. Resolve one exercise, one owner and the current standard for one occurrence, then write. |
| A reminder that names exactly one standalone `workout_format` and matches neither row above. | `tracked-table` | Start a new `activity_session`, read that format, and log the stated set against the workout id that comes back. Leave any older unfinished workout untouched. |
| A reminder with an exact host-preserved `automationId` and no workout reference. | `tracked-table` | Inspect the reminder's saved definition before asking which workout it means, and trust its typed `contextReferences` over the reminder's wording. If that recovers a regimen or experiment reference, use the second row. Start one new session only when the definition is a complete standalone workout and the member explicitly reported finishing a set. The reminder does not prove any other set was done. An unclear definition, or a request to clear a set, writes nothing. |
| None of these resolves exactly. | Nothing | Ask one narrow question and write nothing. |

A marker visible in the transcript, how recent the conversation is, and the last set that was logged are never evidence of where a set belongs.

When the set belongs to a regimen or an experiment:

- Each completion reply to one reminder is one occurrence. It does not confirm the whole day.
- When one message confirms several sets, write one occurrence for each confirmed set against the same exercise and owner, attach the current quantity for a set to every occurrence, and read the owner's progress again before replying.

## Totals

A cumulative repetition total must come from quantities that were actually recorded for each session or set. Never work it out from days elapsed, the planned rotation, assumed adherence, expected occurrences or the current standard for a set. Keep three figures visibly separate: the recorded total, the total full compliance would have produced, and any past quantity that is unknown. When old logs hold completed sets without repetition counts, give the exact number of sets and an honest known subtotal or lower bound.

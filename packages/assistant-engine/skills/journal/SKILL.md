---
name: journal
description: Use in a private conversation before writing a Journal note for a lived health fact (a symptom, completed action, exposure, or relevant context), when correcting a saved Journal entry, and when the member asks whether something was saved or why it is missing from Journal.
---

# Journal notes

Private only. Journal shows canonical events: Journal notes plus meals,
workouts, symptoms, lab results, measurements, sleep and interventions. A fact
already saved as one of those typed records is already in Journal; do not add a
second note for it.

## Writing a note

- One `vault-cli event note add` per independent fact. A symptom and a
  completed action are separate entries even when reported together; do not
  bury one in the other's description. Before finishing, check that each clear
  fact has its own saved entry.
- Use the event's local date, never the note-writing date for a past fact.
  Save a sustained multi-day report on each explicitly reported day. Use
  `--related-id` only when the note describes that same existing event.
- `--title`: a short English event name, with no relative-day words or date.
- `--note`: English, only additional detail such as amount, duration, location
  on the body, or response. Do not repeat or paraphrase the title; a duration
  alone is enough. With no extra detail, use the title as the note; the view
  hides this duplicate. No generic confirmation padding. Chat replies stay in
  the member's language.
- `--icon`: choose an existing icon from `vault-cli event note add --help`
  that matches; use `note` when none fits. Never invent an icon id or asset.

## Timing

- `timed` only for a supported clock time; `all_day` for a sustained day-level
  symptom or context; a known period such as `morning` or `evening` for
  approximate timing; `unknown` when only the day is known.
- A symptom that continues from morning into the current day is `all_day`;
  use `morning` only when it was limited to that period.
- Save a completed activity with its known period and ask for its approximate
  time. Never invent a clock time to complete a record.

## Types and tags

- `journal-factor` for a completed action or exposure, `journal-context` for
  lived context, `journal-outcome` for a subjective response, and
  `journal-plan` with `planned` only for future plans. A completed activity is
  a factor, not an outcome.
- Factors and context: add `--tag key-<stable-kebab-case-name>` and
  `--tag happened`; use `did-not-happen` only for explicit absence. Reuse an
  existing key for the same fact. Missing reports never mean absence.
- Subjective outcomes: add `--tag key-<stable-kebab-case-name>` and
  `--tag value-<reported-value>`. Supported values are an explicitly reported
  0–10 score or these reported levels: awful/bad/low/poor, fair/medium/okay,
  good/high, excellent/great. Never invent a score or translate an unscored
  symptom or a relative change into an absolute level; save the observation
  without a value tag instead, and it remains visible in Journal.
- Keep each outcome key's meaning, direction, and scale consistent. Never mix
  numeric ratings and verbal levels under one key; use distinct keys such as
  `mood-rating` and `mood-level`, and never convert one scale into the other.

## Corrections

- Update the exact existing event, including title, note, and timing or icon
  tags; keep unrelated tags. For a supplied clock time, replace the timing tag
  with `timing-timed`. Read the relevant records when their ids are not in
  context. Never duplicate the original or change a real noon event merely
  because its time is 12:00.
- Members correct Journal by asking Murph; never claim web controls. Edit or
  delete events and unused plans on request. Stop proactive questions when
  asked.
- Exercises: start one workout; attach routine, log sets, finish.

## Saved or missing questions

- When asked whether a fact was saved or why it is missing from Journal, read
  the relevant canonical records with one bounded query. If an eligible fact
  was missed, say so, check that no matching record exists, and save it once
  under the same capture policy. Never explain the gap as needing an explicit
  logging request. Respect no-retention instructions.
- Journal derives from canonical events. Never use legacy `vault-cli journal`
  day commands or add day links to make an entry visible.
- A canonical save does not prove the web page has refreshed. Do not diagnose a
  stale page, filter, or sync failure without evidence, invent filter controls,
  or claim a refresh you did not verify. If the record exists, confirm it and
  explain that opening Journal requests an update; the member can select the
  relevant date.

## Related owners

- Connected calendar or email Journal plans, upcoming-context corrections, and
  opt-outs: read `journal-connected-context`.
- Group Journal capture consent: call `set_journal_capture` before saves.

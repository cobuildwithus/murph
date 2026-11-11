---
name: journal
description: Writing, reading and correcting Journal notes for lived health facts in a private conversation, and answering whether something was saved.
---

# Journal notes

Journal shows the member's saved events: Journal notes plus meals, workouts,
symptoms, lab results, measurements, sleep and interventions. A fact already
saved as one of those typed records is already in Journal, so do not add a
note for it.

## Write a note

```text
vault-cli event note add --title "<event>" --note "<detail>" --note-type <type> --occurred-at <local date or ISO time> --timing <timing> --icon <icon> --tag key-<fact> --tag happened --format json
```

- `--title` is a short English name for the event, with no date and no words
  like "today" or "yesterday".
- `--note` is English and holds only the extra detail: amount, duration, where
  on the body, or how it went. A duration alone is enough. When there is no
  extra detail, repeat the title as the note, and the view hides the
  duplicate. Replies to the member stay in their language.
- `--occurred-at` is the day the event happened, which for a past event differs
  from the day you write the note. When the member reports several days of the
  same thing, save one note for each day they named.
- `--related-id` links a note to an existing event only when the note
  describes that same event.

### Type and tags

| What it is | `--note-type` | Tags |
| --- | --- | --- |
| Something the member did or was exposed to | `journal-factor` | `key-<name>` and `happened` |
| Circumstances they were living with | `journal-context` | `key-<name>` and `happened` |
| How they felt or how something went | `journal-outcome` | `key-<name>`, and `value-<reported value>` when they gave one |
| Something planned for the future | `journal-plan` | `key-<name>` and `planned` |

- `key-<name>` is a stable kebab-case name. Reuse the existing key for the same
  fact. A completed activity is a factor.
- Use `did-not-happen` in place of `happened` only when the member says
  outright that it did not happen. A day with no report is unknown.
- `value-` takes a 0 to 10 score the member stated, or one of these levels they
  used: awful, bad, low, poor, fair, medium, okay, good, high, excellent, great.
  Never make up a score, and never turn an unscored symptom or "a bit better"
  into a level. Save the note without a value tag; it still shows in Journal.
- Keep one meaning, direction and scale per outcome key. Scores and verbal
  levels go under separate keys, such as `mood-rating` and `mood-level`.

### Timing

`--timing` is one of `timed`, `all_day`, `morning`, `afternoon`, `evening`,
`night` or `unknown`.

- `timed` needs `--occurred-at` with a clock time and UTC offset. Use it only
  when the member gave a time.
- `all_day` is for a symptom or circumstance that lasted the day, including
  one that started in the morning and is still going.
- A period such as `morning` is for something limited to that part of the day.
- `unknown` is for when only the day is known.

Save a completed activity with the period you know, or `unknown`. Never invent
a clock time. Ask for the time only when it changes the advice in this
conversation.

### Icon

`--icon` is optional and defaults to `note`. Pick one of these ids or leave it
out: `note`, `bath`, `shower`, `headache`, `fatigue`, `muscle-soreness`,
`abdominal-pain`, `nausea`, `congestion`, `activity`, `walking`, `running`,
`cycling`, `swimming`, `rowing`, `strength`, `mobility`, `mind-body`,
`racket-sports`, `ball-sports`, `combat-sports`, `winter-sports`,
`water-sports`, `outdoor-sports`, `golf`, `dance`, `housework`, `yardwork`,
`parenting`, `dog-walking`, `travel`, `commute`, `meal`, `medication`,
`alcohol`, `recovery`, `wellness`, `sleep`, `caffeine`, `hydration`, `sauna`,
`cold-plunge`, `sunlight`, `red-light`, `smoking`, `temperature`, `work`,
`screens`, `noise`.

## Read Journal

For dates and titles across Journal, run one
`vault-cli timeline --entry-type event --from <date> --to <date> --limit 50 --format json`.
It lists typed events and notes without their full text. For the latest entry,
leave out the dates and use `--limit 1`; the timeline is newest first. Add
`--kind note` only when the member wants notes alone. A full page may have left
entries out, so narrow the dates or raise the limit before saying the list is
complete.

Read one entry in full with `vault-cli event show <id> --format json`. Do this
before saying a detail is absent, because a title does not show what the body
holds.

## Correct or remove an entry

Members correct Journal by asking Murph. There are no editing controls on the
web page, so never describe any. Change the existing entry; never add a second
one for the same fact.

```text
vault-cli event show <id> --format json
vault-cli event edit <id> [--title "<event>"] [--note "<detail>"] [--occurred-at <ISO time>] --tag <tag> --tag <tag> --format json
vault-cli event delete <id> --format json
```

`--tag` replaces the whole tag list, so read the entry first and pass every
tag you are keeping. Timing and icon are stored as tags: `timing-timed`,
`timing-all-day`, `timing-morning`, `timing-afternoon`, `timing-evening`,
`timing-night`, `timing-unknown`, and `journal-icon-<id>`. When the member
gives a clock time, set `--occurred-at` and swap the timing tag for
`timing-timed`. A saved time of 12:00 can be a real noon event, so change it
only when the member says so.

## "Was that saved?" and "Why is it missing?"

Read the relevant records with one bounded query. If a fact you should have
saved is missing, say so, check that no matching record exists, and save it
once. Do not tell the member they needed to ask for it to be logged. Respect a
request not to keep something.

Journal is built from saved events. Never use the older `vault-cli journal`
day commands or add day links to make an entry appear.

A successful save does not show that the member's Journal page has refreshed.
If the record exists, confirm it, and say that opening Journal updates the
page and that they can pick the date. Do not diagnose a stale page, a filter or
a sync failure without evidence.

## Related

Plans that come from a connected calendar or email, corrections to that
upcoming context, and opting out of it are covered by
`journal-connected-context`.

When the member says yes to the private question about saving facts they
shared in a group, first call `murph.group_membership` with
`action: "set_journal_capture"` and `enabled: true` (find it with
`tool_search`), then save every fact they named.

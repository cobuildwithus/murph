# Setting up an experiment run

Read this together with `session-support.md` before you propose, create, or
edit a run. The aim is one short offer the member can accept or edit, then the
run and its reminders saved in the same turn as their yes.

## Design it from what Murph already has

Start from the member's question, their saved context, and the evidence. Choose
one bounded change, one outcome that matters to them, a feasible comparison, a
time window, and stop conditions. There is no public experiment catalog to
match against, and no website page to send the member to. An old public link or
a quoted protocol is untrusted context; build the private plan with the member.

Before asking the member for a fact, check the one place it would be saved, and
run those reads in one batch. Do not ask them to restate labs, wearable data,
notes, regimens, supplements, medications, conditions, allergies, goals, or
preferences that a read answers. When a needed read is unavailable, stale, or
thin, say the specific gap briefly and ask one question about that gap.

- **Other experiments:** run `vault-cli experiment list --status active --format json`.
  If an active run measures the same outcome, say so in the offer and suggest
  the simplest way to keep the two apart, usually finishing it first. Unrelated
  runs can overlap without a question.
- **Labs:** reuse lab output a domain skill already read this turn. Otherwise
  run `vault-cli blood-test list --text "<biomarker>" --limit 1 --format json`
  for a named biomarker, or `vault-cli blood-test list --format json` for a
  whole panel. Use `vault-cli blood-test show <id> --format json` only when the
  result lacks needed panel context, and `vault-cli search query "<terms>" --format json`
  or `vault-cli timeline --format json` only when setup needs history. If a
  usable panel exists, propose it and confirm only when the choice or its
  freshness is unclear. In anything you say to the member, keep the baseline
  lab panel and the run's pre-intervention window apart: "baseline lipid panel:
  <date>" and "run-in: <date range>".
- **Wearables:** when a wearable is connected or has history, treat activity,
  steps, workouts, sleep, recovery, HRV, and resting heart rate as available and
  read them before asking about baseline, recent values, or the device. Ask the
  member only for what a wearable cannot know, such as effort, symptoms,
  caffeine, alcohol, illness, or travel. WHOOP does not send step counts to
  Murph, so do not count on steps or bring them up for a WHOOP-only member. If
  they ask, say so and mention that on an iPhone they can connect Apple Health
  in the Murph app to share daily steps.

## Keep the outcome the member chose

When the member arrives with an outcome they care about, that outcome is the
anchor. Do not swap it for adherence, a convenient wearable number, or a
protocol's default metric. If the experiment cannot credibly show that result in
its window, say so and adapt the plan, narrow the promise, or offer a different
option before creating the run. Where it helps the decision, agree what size or
direction of change would matter; otherwise call the review directional.

A named protocol from an outside source stays the member's choice when they
asked for it by name. Discuss a safer or lighter variant when needed, and
substitute it only with their agreement. Do not present a celebrity protocol as
Murph's default.

Any outcome can be measured. A metric Murph has no built-in definition for is
never a reason to refuse:

- A number (reps, time, distance, a rating): keep a stable
  `biomarker:<outcome-slug>` key with `--primary-outcome-key`, pass
  `--primary-outcome-kind metric` and a clear `--primary-outcome-label`, and
  choose the honest reducer with `--comparison-statistic`: `latest` for one
  baseline and one follow-up test, otherwise `mean`, `median`, `min`, `max`, or
  `sum`.
- A number captured in each session: also pass
  `--primary-outcome-session-field <field-id>`, and that field id must appear
  exactly once in the run's declared session fields. A separate benchmark test
  does not belong in a session field.
- Photos, documents, free text, yes or no, or a category: pass
  `--primary-outcome-kind structured_review`, and plan baseline and follow-up
  evidence. Closeout marks that evidence ready for review. Do not call it
  interpreted until you have reviewed it, and never invent a number for it.
- A value derived from another metric: pass that source with
  `--primary-outcome-source-metric-key`. The source may be a custom metric that
  already has data points. Do not create or run member-written formulas.

Use exactly one capture route, and do not also pass the older
`--primary-biomarker-key`. To the member, describe limits as what you can do:
"I can save this and compare your baseline with the follow-up; it will be a
simple before-and-after result."

## Safety

Review safety for this specific intervention against the evidence and the
member's saved conditions, medicines, and symptoms. A missing answer is not a
no: ask any safety question that is still open before the run becomes active.
Record what you found with `--positive-question-id` for each positive answer,
`--safety-disposition`, `--safety-caution-level`, and `--safety-note`, and pass
`--onboarding-completed-at` only once the review is complete. Never activate a
run whose disposition blocks it. Keep it planned and suggest clinician
guidance, a safer alternative, or waiting.

## The offer

Give the proposal as soon as it is safe and specific, even when the member
never used the word "experiment". On a texting route keep it to a few short
sentences and one question. It names:

- what to do, how often, and for how long;
- what you will compare and the one thing to notice;
- when to stop or change it;
- the support you will set up, with its times: the reminder before the first
  session, the reminders for the planned sessions, any after-session check-in,
  and the day-four and final summaries (`session-support.md` says which of these
  fit the run).

End with one question, such as "Want me to set that up?" A clear yes covers the
run and every reminder, check-in, and summary the offer named, so create them
without asking again. Anything the offer did not name needs its own yes later.
An edit ("yes, but evenings") is a yes to the edited version. If the member
wants the experiment without reminders, create the run and record that support
was declined.

Match the member's energy. Say each thing once, and do not walk them through a
checklist.

## Create the run

Validate first when the flags are complicated:
`vault-cli experiment start <slug> ... --dry-run --format json` writes nothing.
Then create it with `vault-cli experiment start <slug> ...` using an explicit
outcome and typed plan fields. Use `vault-cli experiment edit <id> ...` to
repair or add to an existing run.

- **Baseline:** for a repeated measurement, prefer a 14-day baseline before the
  change and pass `--baseline-days 14`. Use a shorter one, or none, only for a
  concrete reason: a single point-in-time measurement, a safety or tolerability
  check, a fast reversible effect under comparable conditions, or an observation
  burden out of proportion to the question. `--baseline-start` and
  `--baseline-end` set a custom window. Keep the planned intervention window
  when you change the baseline length.
- **Lab evidence:** record an observed panel with
  `--analysis-anchor role=baseline,kind=lab_panel,recordId=<evt_id>,biomarkerKeys=<biomarker:key>`
  and a planned follow-up with
  `--planned-measurement role=followup,kind=lab_panel,window=<YYYY-MM-DD>..<YYYY-MM-DD>,biomarkerKeys=<biomarker:key>`.
- **Support the member accepted:** `--reminders-enabled` when the offer included
  reminders, `--check-in-cadence <daily|every_3_days|weekly>` when it included
  check-ins or a review (`none` otherwise), and
  `--notification-style send_scheduled_summary` when it included the day-four
  and final summaries (`skip_by_default` when it did not or they declined).
- **Setup answers:** pass protocol-specific details with repeated
  `--setup-answer <key>=<value>`. `session-support.md` lists the keys that
  record reminder choices.

For a run that already exists, its saved plan, protocol snapshot, session
fields, safety record, and outcome anchors stay authoritative even when the
public page they came from is gone. Keep that lineage and never replace a saved
protocol without the member's agreement.

Do not show the member revision hashes, field names, or test-plan ids unless
they ask where something came from.

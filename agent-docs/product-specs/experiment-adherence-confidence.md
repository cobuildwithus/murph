# Experiment Adherence Confidence

Last verified: 2026-08-09

## Current State

Murph experiment adherence is a read-time interpretation of private run plans and evidence events. Non-sensable cadence experiments should not punish silence as non-adherence. Device-observable experiments should still treat missing sensed activity as a real signal.

This spec covers the V2 adherence confidence model for progress, reminders, digests, and outcome confidence. It does not add a new state owner, writer, cron job, or lifecycle hook.

## Product Boundary

Adherence confidence is derived at read time from existing experiment run plans, adherence targets, schedule cells, and evidence events.

- Non-sensable cadence targets use `assumed_after_grace` for missing linked-event evidence.
- Device-observable activity targets keep `missed_after_grace`.
- Explicit user corrections always outrank assumptions.
- Calendar-backed linked-event progress counts occurrences rather than collapsing every date to one session. `expectedSessionsByNow` sums each due cell's `expectedCount`, and explicit evidence is capped at that count so duplicate same-date events cannot overstate progress.
- Progress and outcome surfaces preserve the established completed/logged assumption contract while exposing sensed, confirmed, and assumed occurrence counts separately.

Actual quantities such as repetitions are stricter than adherence progress: they must be summed from explicit canonical records carrying the quantity. Neither an assumed occurrence nor a theoretical schedule projection is evidence of a historical repetition total. `progress.adherence.sessionEventIds` follows the same capped occurrence selection, so downstream quantity reads do not reintroduce duplicate same-day logs.

A new count-backed target with more than one expected occurrence per date requires explicit per-occurrence evidence. Assistant-managed repeated exercise targets must not use silence to backfill completion.

Assumption is not a generated event. It is a status on a schedule cell after the planned session's grace window passes with no explicit evidence.

Calendar-less count targets have no per-day planned cells. They can count logged evidence, including derived evidence when present, but there is no missing planned date to assume.

## Confidence Ladder

The adherence ladder has three sources:

| Source | Meaning | Typical evidence |
| --- | --- | --- |
| Sensed | A device or import supplied the session. | Activity sessions from wearable or provider imports. |
| Confirmed | The user manually logged or corrected the session. | `intervention_session` or manual activity evidence. |
| Assumed | The planned non-sensable session passed grace with no explicit evidence, or a derived event was counted. | `assumed_after_grace` schedule cells. |

Progress summaries may include optional `sensedSessions`, `confirmedSessions`, and `assumedSessions` counts. Omit zero-count fields to keep payloads lean and older snapshots readable.

## Assumed After Grace

For linked-event adherence targets with `missing: assumed_after_grace`:

1. Before the grace window closes, the planned cell remains `scheduled`.
2. After grace with no evidence, the cell becomes `assumed`.
3. `assumed` counts its expected occurrences as completed/logged for progress and target pacing, while `assumedSessions` keeps the confidence source explicit.
4. UI copy for an assumed schedule cell is short and distinct: "Assumed done".
5. Weekly digests and reminder tails can say: "I've been assuming your sauna sessions happened - say the word if any didn't and I'll update your log."

Synthesized legacy intervention-session targets default to `assumed_after_grace`. Synthesized activity-session targets keep `missed_after_grace`.

## Corrections

Corrections are explicit evidence, not edits to assumption logic.

If a user says a planned non-sensable session did not happen, log that date with an explicit status such as:

```sh
vault-cli experiment session log <id> --date <date> --status skipped
```

or:

```sh
vault-cli experiment session log <id> --date <date> --status missed
```

That explicit status flips the schedule cell from `assumed` to `missed` and reduces completed/assumed counts. Assistants should not delete events, write derived assumption events, or double-log confirmations. A user saying "yep all done" is conversational confirmation only; the assumed cells already count.

## Typed Subjective Session Evidence

An intervention-session event may be both confirmed adherence evidence and a typed subjective-outcome observation.

- The run declares allowed field ids in `runPlan.logging.sessionFields`. `intervention_session.fields` accepts bounded strings, finite numbers, booleans, and `null`; undeclared fields, duplicate ids, duplicate aliases for one canonical metric, and recognized values outside their allowed type or range are rejected.
- A recognized numeric field contributes a metric point only when the session is linked to this experiment by its id or slug. A simultaneous unrelated run must not inherit it.
- The session event itself already supplies confirmed adherence. Do not emit a second event merely because one of its fields also supplies outcome evidence.
- A missing subjective field is missing outcome evidence, not proof that the planned intervention was missed. Adherence state still follows the session event, explicit corrections, and the target's missing-evidence policy.

## Follow-Up Behavior

Assumed-mode experiments do not send per-session missing-log nags. `experiment followup due --kind missed-log` should skip assumed targets with `session_assumed`.

The confirm-or-correct touchpoint belongs in existing surfaces:

- progress moments
- weekly digests
- short reminder tails when a reminder is already being sent

It should never become a required question.

## Outcome Confidence

Outcome confidence keeps the existing confidence enum. When `assumedSessions` is greater than `sensedSessions + confirmedSessions`, add this reason:

"Most sessions are assumed rather than confirmed."

The existing reason-count mechanism demotes confidence. Results based mostly on assumptions should read as provisional; results with mostly sensed or confirmed adherence should not carry this reason.

Subjective outcome confidence also depends on actual field coverage. Do not zero-fill missing ratings or substitute an adherence assumption for a sleep-quality, sleepiness, arousal, soreness, latency, or timing observation.

## Category Evidence

The `cardio` activity category matches a conservative set of device-observable activity kinds:

- running
- cycling
- swimming
- rowing
- elliptical

Walking and hiking are deliberately excluded. Strength training is excluded. Category matching is explicit through the shared activity-kind matcher; category tokens should not match by alias fallback accidentally.

Cardio experiment evidence resolves to:

```ts
{ eventKind: "activity_session", activityKind: "cardio" }
```

Downstream surfaces such as missed-log device checks, dedupe, device-activity automations, and browser progress inherit this through the shared matcher.

## V3 Not In Scope

V2 intentionally does not add:

- per-dose confirm buttons
- category customization UI
- user-owned category membership settings
- generated adherence events
- new automation kinds
- new lifecycle writers
- a separate habit or adherence state owner

Add those only after a concrete product need proves the read-time model is insufficient.

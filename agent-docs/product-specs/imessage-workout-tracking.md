# iMessage workout tracking

## Product outcome

A private member can run a strength workout from the Murph conversation:

- see today's ordered exercises and completed/remaining set counts;
- open an exercise to see each set's target and recorded result;
- compose an explicit command to log, correct, or finish the workout;
- continue using ordinary text for free-form gym updates.

The experience borrows the useful workout-tracker loop—plan, log sets, correct, finish—without introducing a second workout product or data store.

## Authority boundary

- A saved workout format owns planned exercises, stable exercise identity, planned sets, and target values.
- One canonical `activity_session` workout event owns session timing and actual completed sets.
- A response card is an immutable snapshot. It never owns workout state.
- The Messages extension has no vault credentials, shared authentication state, network client, cache, or persistence.
- Every card action inserts a command into the Messages composer. The member sends it through the normal Murph conversation path, which remains the sole mutation owner.

## Response-card contract

The assistant continues authoring `compact_table` V1. A tracked live workout may add structured `workout` detail:

- `state`: `active` or `completed`;
- ordered exercises;
- ordered sets with `pending`, `completed`, or `skipped` status;
- a compact target string and actual-result string.

The outer table remains a deterministic summary:

- `rowHeader="Exercise"`;
- `columns=["Progress"]`;
- one row per exercise;
- each value is `<completed>/<total>`.

Tracked workout detail requires a canonical tracking marker in durable transcript context. The native URL strips the event id and snapshot time.

Generic compact tables keep the existing schema-version-3 native envelope. Enhanced workout tables use the bounded schema-version-4 envelope. Both stay under the existing 2,048-character URL ceiling.

## Plan versus actual

Targets and actual results must remain distinct:

- planned targets come from the verified workout format;
- completed actuals come from the verified canonical workout event;
- a target is never evidence that a set was completed;
- pending planned sets become skipped only when the workout is explicitly finished;
- additional actual sets beyond the format are included with no target.

An active workout may have zero pending sets after the final result is logged; it remains active until the member explicitly finishes it.

## Command loop

The native app composes explicit one-based commands such as:

- `Log workout exercise 2 set 1: `
- `Complete workout exercise 2 set 1 at its shown target.`
- `Correct workout exercise 2 set 1: `
- `Finish this tracked workout.`

The assistant resolves the command against the latest tracked workout in the same private conversation, re-reads canonical state, preserves unrelated fields, applies the existing guarded workout mutation, re-reads again, and only then sends a refreshed immutable card.

## Rollout

Deploy the native schema-version-4 reader before enabling broad schema-version-4 emission. Older app versions retain truthful text and Linq fallback layouts, but do not provide the drill-down workout interface.

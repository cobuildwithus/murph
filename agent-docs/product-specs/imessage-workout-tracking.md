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
- One canonical `activity_session` workout event owns session timing, unlogged set coordinates, and actual completed-set values. Planned targets are not copied into those placeholders.
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
- `Correct workout exercise 2 set 1: `
- `Finish this tracked workout.`

The assistant resolves the command only when one tracked workout is unambiguous in the same private conversation. It may prefer the latest verified snapshot only when no second session is plausible; the inserted text itself is never identity or write authority. This keeps the common path to one tap and one sent reply. An ambiguous older card deliberately requires one narrow clarification instead of carrying a native correlation token, canonical event id, or write authority.

The command numbers are one-based presentation positions, not canonical workout-order values. For set commands, the assistant resolves the exact active event, checks that the card's ordered exercise names and set counts still map unambiguously to it, and translates each display position to the current canonical `exercise.order` and `set.order`. It invokes the targeted `workout set log` or `workout set clear` command with the canonical workout id, exact displayed exercise name, and mapped orders. The card never offers a generic “complete at target” shortcut because range, AMRAP, null, and qualitative targets are not concrete actual performance. Card-driven set logging requires the mapped set to exist, so a stale name, order, or position fails instead of appending a new set.

Finish branches before the active-only set preflight. The assistant invokes the exact event's idempotent `workout finish` command and accepts an already-completed return as convergence, allowing a refreshed completed card after an earlier response or delivery failure. The command owner preserves unrelated state and returns the verified canonical event; only that success permits a refreshed immutable card.

## Rollout

Deploy the native schema-version-4 reader before enabling broad schema-version-4 emission. Older app versions retain truthful text and Linq fallback layouts, but do not provide the drill-down workout interface.

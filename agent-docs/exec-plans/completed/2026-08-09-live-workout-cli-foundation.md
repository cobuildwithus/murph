# Live workout CLI foundation

Status: completed
Created: 2026-08-09
Updated: 2026-08-09
Completed: 2026-08-09

## Goal

Let a private member run one structured workout through ordinary Murph messages without making the conversation, table card, or another database the source of truth.

## Scope

- Add targeted `workout start`, `workout active`, `workout finish`, `workout exercise add`, `workout set log`, and `workout set clear` commands.
- Keep canonical `activity_session` events and saved workout formats as the only durable owners.
- Start saved routines with unlogged set placeholders so target values are not mistaken for completed work.
- Move ordinary live-set updates away from model-authored full nested replacements.
- Tighten the existing tracked-table skill around explicit exercise/set identity, verification, corrections, and low-noise card refreshes.

## Invariants

- At most one Murph live workout is active per vault.
- Existing historical and imported workouts are not reclassified as active; the live surface owns an explicit `murph-live` source marker plus start/end timestamps.
- A set command changes one identified set while preserving every other exercise and set.
- Agent writes use an explicit workout id, exercise selector, and set order so retries overwrite the same set rather than append a duplicate.
- Saved routine targets remain in the routine. A live session contains placeholders until actual values are reported.
- Finishing records elapsed duration but never fills missing set values from the plan or prior history.
- Compact tables remain immutable snapshots and never become workout authority.

## Complexity intentionally avoided

- no new workout record family
- no database table, tracker document, queue, lock service, or synchronization owner
- no mutable iMessage card or extension networking
- no program planner, analytics service, timer service, or web UI in this slice
- no schema migration

## Verification

- Focused vault-usecase tests cover routine-to-live placeholder semantics and active/completed classification.
- Focused CLI integration covers start, duplicate-start rejection, active resolution, explicit set logging, retry idempotence, exercise addition, set clearing, finish, finish retry, and no-active state.
- Focused assistant-skill coverage pins the targeted command flow, no-inference rules, canonical set notes, and four-set presentation behavior.
- Exact-head repository CI remains the broad typecheck, generated CLI-artifact, package, and release verifier.

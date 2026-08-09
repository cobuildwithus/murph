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
- Reuse the existing canonical resource-lock primitive to serialize the short read-modify-write window for one live session per vault.
- Tighten the existing tracked-table skill around explicit exercise/set identity, verification, corrections, and low-noise card refreshes.

## Invariants

- At most one Murph live workout is active per vault, including concurrent start attempts.
- Existing historical and imported workouts are not reclassified as active; the live surface owns an explicit `murph-live` source marker plus start/end timestamps.
- A set command changes one identified set while preserving every other exercise and set, including overlapping targeted updates.
- Agent writes use an explicit workout id, exercise selector, and set order so retries overwrite the same set rather than append a duplicate.
- Saved routine targets remain in the routine. A live session contains placeholders until actual values are reported, saved distance defaults are not recorded as completed distance, and template prose is not copied into the live event note as completion evidence.
- Saved routine notes remain available on the nested live session without passing through freeform workout inference.
- Explicit live activity-type overrides are normalized to the same lowercase slug shape required by canonical activity sessions.
- Finishing records elapsed duration but never fills missing set values from the plan or prior history.
- Compact tables remain immutable snapshots and never become workout authority.

## Complexity intentionally avoided

- no new workout record family
- no database table, tracker document, queue, lock service, or synchronization owner
- no broad vault-wide lock around the workout; the existing per-vault logical-resource lock covers only the live-session mutation window
- no mutable iMessage card or extension networking
- no program planner, analytics service, timer service, or web UI in this slice
- no schema migration

## Verification

- Focused vault-usecase tests cover routine-to-live placeholder semantics, saved routine-note fallback, and active/completed classification.
- Focused CLI integration covers start, activity-type normalization, planned-text/distance separation, duplicate-start rejection, active resolution, explicit set logging, retry idempotence, exercise addition, set clearing, finish, finish retry, and no-active state.
- Concurrent CLI coverage proves that simultaneous starts yield one active session and overlapping set writes preserve every set.
- Focused assistant-skill coverage pins the targeted command flow, planned-versus-actual separation, fail-closed full replacements, no-inference rules, canonical set notes, and four-set presentation behavior.
- Active-session discovery performs one canonical query read rather than a bounded list followed by repeated full-vault reads.
- Exact-head repository CI remains the broad typecheck, generated CLI-artifact, package, and release verifier.

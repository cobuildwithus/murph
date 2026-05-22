# Legacy wearable receipt compaction

Status: active
Created: 2026-05-22
Updated: 2026-05-22

## Goal

- Implement the narrow `legacy-wearable-receipt-compaction-v1` migration from
  `agent-docs/exec-plans/completed/GARMIN_CLEANUP.MD`.
- Remove only legacy top-level `payload` fields from wearable raw receipt
  artifacts after exact duplicate provider evidence is proven.
- Preserve provider raw artifacts, canonical records, ledgers, metric samples,
  raw paths, raw refs, query/browser-vault behavior, and existing wake slots.

## Success Criteria

- Core owns a conservative detector and compactor with strict manifest
  checksum/size validation, exact duplicate proof, bounded resumability,
  metadata-only audit, and no raw deletion.
- Importers and core share the same wearable payload hash normalization helper
  without introducing a core-to-importers dependency.
- Hosted runtime has one non-AI housekeeping lane that handles the single
  compaction wake before assistant hydration, ignores request reason, skips when
  fresh conversation input exists, and publishes through existing dirty
  `idle_shutdown` checkpoints.
- Fresh foreground runs may schedule the maintenance wake only when the single
  wake slot is absent or already maintenance, and never due before the current
  idle-checkpoint delay plus grace.
- Focused core/runtime tests cover the required invariants; required
  verification and completion audits pass or documented unrelated blockers are
  precise.

## Scope

- In scope:
  - `packages/core` hash helper, compactor, exports, and focused tests.
  - `packages/importers` receipt hash wiring and parity tests.
  - `packages/assistant-runtime` hosted housekeeping hook, scheduling, and tests.
  - Narrow architecture documentation for the raw receipt rewrite exception.
- Out of scope:
  - Provider raw artifact deletion or garbage collection.
  - Provider-specific Garmin/Junction/WHOOP reconstruction logic.
  - Query/browser-vault schema or read-model changes.
  - New workspace DB fields, generic maintenance queues, durable cursors, or a
    second wake slot.

## Constraints

- Preserve unrelated working-tree edits and active ledger rows.
- Do not write legal names, local account names, home paths, secrets, raw health
  payloads, provider payload bodies, or direct user identifiers into docs, code,
  tests, logs, commits, or handoff notes.
- Keep the architecture simple: one wake reason, one hosted housekeeping lane,
  one core mutation, and no generic maintenance framework.

## State

- Current repo imports already emit payload-free wearable raw ingest receipts.
- The shared wearable payload hash helper, core legacy receipt detector/compactor,
  focused core tests, and hosted housekeeping lane implementation are in place.
- Focused runtime tests and final verification/audits are in progress.
- Unrelated Temporal/device-sync work is dirty in the current checkout and must
  not be touched by this task.

## Tasks

1. Inspect core raw manifest/write/audit seams and assistant-runtime runner wake
   flow.
2. Add shared hash helper and migrate importer receipt hashing to it.
3. Add core detector/compactor and tests.
4. Add hosted housekeeping lane, scheduling integration, and runtime tests.
5. Document the narrow raw receipt rewrite exception.
6. Run required verification/audits and close with a scoped commit if safe.

# PR 632 ReviewGPT round 2

## Goal

Make exact WHOOP spot-RMSSD admission replay resolve through retained source
revision history before a mutable vault-timezone daily key can select a
neighboring event.

## Constraints

- Derive the replay index from the existing event revision ledger.
- Add no migration, durable alias, queue, or identity owner.
- Keep the behavior scoped to WHOOP companion daily RMSSD under the existing
  higher-confidence policy.
- Fail closed when one source version is retained under multiple event owners.

## Approach

1. Index every retained WHOOP companion RMSSD source version to its current
   event owner while scanning the existing event ledger.
2. Resolve an exact source version before the recomputed daily external
   reference, and keep the derived index current during a multi-entry import.
3. Add adjacent-day collision and historical-lower-confidence replay tests.
4. Run focused and package verification, completion audits, commit, push, and
   rerun ReviewGPT against the new exact head.

## State

Active.

Status: active
Updated: 2026-07-14

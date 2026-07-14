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

Complete.

ReviewGPT round 2's replay-identity finding was accepted. Exact companion
source versions now resolve through an in-memory owner index derived from all
retained event revisions before the mutable daily key. The implementation adds
no persisted alias, migration, queue, or lifecycle owner. Regression coverage
proves adjacent-day collision safety, historical lower-confidence replay, and
strict no-mutation failure when one source version has multiple owners.

Verification on the TypeScript 7 mainline:

- core and importers typechecks passed;
- focused core device-import/validation tests passed (145/145);
- Junction importer tests passed (141/141);
- core coverage passed (672/672; 90.04% statements, 81.68% branches);
- importers coverage passed (363/363; 90.79% statements, 82.95% branches);
- docs drift and diff checks passed;
- coverage-write added the ambiguity regression and has no unresolved finding;
- security/privacy review found no medium-or-higher issue.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14

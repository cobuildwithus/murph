# Replay ordinary reminder saves by accepted input

Status: active
Created: 2026-11-06
Updated: 2026-11-06

## Outcome

Prevent duplicate reminders after a canonical write survives a killed run. Core owns positional input slots; the hosted tool owns only a per-run claimed set. No new persisted state or payload identity.

## Reaches

Ordinary scoped saves return current stored purpose without writing. The model reconciles matching and unrelated purposes; replay cannot clear a pending DST correction. Recipe, onboarding, and unscoped saves keep existing behavior. A scope omitting the owning input remains outside the guarantee.

## Proof and tasks

1. Reproduce two records across fresh hosted tool instances before source changes.
2. Implement core slots and trusted scope plumbing, purpose response, and DST guard.
3. Prove restore receipts, concurrency, serialization, and hosted journeys with focused tests; add two live journeys.
4. Run the three package typechecks and complexity diff, review privacy and the diff, and make one local commit.

## Constraints and risks

No push, PR, deploy, apps, schema, or dependency changes. Existing old randomly generated records cannot be retroactively assigned to inputs; omitted input scopes can duplicate. Failures claim nothing and replay preserves edits, archive state, routes, and bytes. The existing canonical write/checkpoint recovery remains authoritative.

## Verification

Hosted replay and restore proof pass (44 tests); core proof passes (32 tests). All three package typechecks pass. Engine verification passes across the full-file run and the focused DST correction rerun (173 exercised cases; six existing skips). The two live journeys remain unrun for the reviewer. Keep this plan active.

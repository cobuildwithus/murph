# Replay ordinary reminder saves by accepted input

Status: completed
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
4. Run the three package typechecks and complexity diff, review privacy and the diff, and commit.

## Constraints and risks

No deploy, apps, schema, or dependency changes. Existing old randomly generated records cannot be retroactively assigned to inputs; omitted input scopes can duplicate. Failures claim nothing and replay preserves edits, archive state, routes, and bytes. The existing canonical write/checkpoint recovery remains authoritative.

## Verification

Focused core, hosted runtime and engine suites pass, including cold restore with Web committed and not committed, and the timing readback path. All three package typechecks and `pnpm complexity:diff` pass. Two real-Codex journeys passed on `gpt-6.1-sol`, with one and two saves, one run each. The first provider request is byte-identical at base and head because the automation tool is deferred.
Completed: 2026-11-06

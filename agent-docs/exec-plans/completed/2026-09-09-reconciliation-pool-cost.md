# Reduce usage-period query cost and correct reconciliation logs

Status: completed
Created: 2026-09-09
Updated: 2026-09-09

## Goal

- Remove a redundant usage-period database round trip and stop labeling due
  scheduled work as idle in reconciliation diagnostics.

## Success criteria

- Preserve period creation, row-lock ordering, billing transitions, and spending.
- Read period fields in the locking query; remove the lock-only helper.
- Cover due, future, absent, mailbox, and blocked reconciliation log states.
- Pass focused unit/PostgreSQL proof, Web typecheck, and parent review.

## Scope

- In scope: existing usage allowance owner, reconciliation diagnostics, focused proof.
- Out of scope: scheduling changes, pool sizing, caching, billing policy, deployment.

## Constraints

- Keep the existing transaction and creation path. No state or dependencies.
- Use synthetic test data. No production evidence or identifiers in artifacts.

## Risks and mitigations

1. Raw locked reads must retain field types and serialization.
   Mitigation: generated model types and real PostgreSQL regression proof.
2. Diagnostics must not become a second scheduler.
   Mitigation: derive status only from already-loaded facts and the request clock.

## Tasks

1. Combine the locked period read and delete the redundant owner helper.
2. Include due workspace wakes in the existing diagnostic status.
3. Run focused tests/typecheck, review the full diff, and commit.

## Decisions

- Preserve insert-on-conflict creation rather than introducing an existing/missing
  fast-path branch. One fewer round trip with fewer moving parts.
- No changelog: internal query optimization and operational diagnostics only;
  member-facing billing, scheduling, and responses retain their existing behavior.

## Verification

- Eight focused Web suites: 295 tests passed, covering allowance policy,
  reconciliation facts/timing, PostgreSQL period acquisition, plan resets,
  operator resets, usage recording, and group funding.
- PostgreSQL proof ran against an isolated, migrated loopback database.
  The original source fails the new assertion with three period statements;
  the final source passes with two for both creation and reuse. Contention
  proof confirms committed spending is read before the gate records exhaustion.
- `pnpm --dir apps/web typecheck:prepared`: passed after final TypeScript edits.
  Full `typecheck` generated its prerequisite artifacts first.
- `pnpm complexity:diff`: passed. Allowance complexity is unchanged;
  reconciliation complexity debt decreased from 16 to 13.
- Parent review: period creation/member-before-period locks, nullable/date/BigInt
  fields, billing transitions, and fail-closed behavior remain intact. Logging
  derives from the request clock and existing facts, with no scheduling authority.
- Internal-only change; no public changelog. Web-only deployment, no migration or
  Worker ordering requirement. No deployment or remote PR/CI work performed.
Completed: 2026-09-09

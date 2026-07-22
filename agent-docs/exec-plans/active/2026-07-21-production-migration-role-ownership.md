# Unify production migration ownership

Status: active
Created: 2026-07-21
Updated: 2026-07-21

## Goal

- Stop Vercel predeploy and GitHub postdeploy migrations from creating or
  altering schema through different object owners.
- Repair the current ownership drift, rerun the blocked group-funding contract
  migration, and leave a fail-fast guard that prevents recurrence.

## Success criteria

- One canonical production schema-owner role owns both migration ledgers and
  all application schema objects; separate dedicated deployment logins may
  assume that owner without sharing a credential.
- Both production migration entrypoints assume the canonical owner and reject
  it if it does not own the Prisma migration ledger before executing migration
  SQL.
- The blocked group-funding contract migration is recorded and both checks are
  installed and validated with zero violating rows.
- Focused migration tests, diff-aware verification, required audits, CI, and
  ReviewGPT pass for the exact PR head.

## Scope

- Hosted Web production migration runners, their focused tests, and current
  deployment documentation.
- PlanetScale production object ownership plus the Vercel and GitHub migration
  credential bindings.
- Manual rerun of the repository-owned postdeploy contract workflow after the
  production alias and drain gates.

## Constraints

- Do not expose or download database credentials.
- Do not add per-table ownership exceptions, a second migration ledger, or a
  fallback DDL path.
- Preserve the direct-connection, current-production alias, bounded-drain,
  advisory-lock, timeout, and checksum invariants.
- Production inspection remains metadata- and count-only.

## Tasks

1. Prove the current ownership and migration-state split from CI and production
   metadata.
2. Add one shared ownership preflight to both production migration entrypoints
   with focused regression coverage.
3. Document the single-owner credential contract and recovery procedure.
4. Reassign drifted objects to the canonical owner and verify that both
   deployment-system logins can assume it without exposing credentials.
5. Complete verification and review, merge, rerun the blocked contract
   migration, and verify the production constraints and migration record.

## Evidence

- The failed postdeploy run reached the queued group-funding migration and
  PostgreSQL rejected its first `ALTER TABLE` because the workflow login did
  not own the purchase table.
- The canonical `postgres` role owns 63 application relations including the
  Prisma ledger. Eleven newer application tables and the contract ledger are
  split across two login-role owners; both owners can assume `postgres`, so no
  shared credential or new role is required.
- The pending table has no target constraints yet, and count-only preflight
  shows zero rows violate either intended check.

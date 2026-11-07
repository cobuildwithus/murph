# Preserve sponsorship top-up compatibility

Status: completed
Created: 2026-09-22
Updated: 2026-09-22

## Goal

Allow new $4 usage grants on $5 sponsorship purchases while preserving historical $5 grants.

## Tasks

1. Reproduce the existing database constraint failure against fully migrated local PostgreSQL.
2. Add a forward widening migration without rewriting purchase or ledger history.
3. Verify current and legacy activation, frozen-grant fulfillment, refill replay, and malformed-shape rejection.
4. Correct rollout guidance, run focused tests and typecheck, and close this plan before the next final review.

## Decisions

- Accept the confirmed ReviewGPT finding after the user requested continuation.
- Apply the migration before new Web instances reserve reduced grants. Keep it during rollback.
- Reuse the existing PostgreSQL concurrency suite and production authorization, ledger, and refill owners.

## Verification

- Before the migration, both current activation and legacy activation followed by a current refill failed the PostgreSQL sponsorship-shape constraint.
- Applied all 239 existing migrations to an isolated local test database, then the new migration through `pnpm --dir apps/web prisma:migrate:deploy` after registering its narrow compatibility exception.
- All 117 tests passed across the PostgreSQL concurrency suite (46), production migration guard, and top-up product spec. The ten new cases cover current/legacy activation and frozen-grant fulfillment, current refill replay, and eight malformed shapes.
- Web typecheck and focused ESLint passed. No production payments or production database changes were made.
- Final exact-head CI and ReviewGPT round 2 follow the committed candidate; PR completion remains gated on them.
Completed: 2026-09-22

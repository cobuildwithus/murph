# Unblock the Pulse attribution production deploy

Status: completed
Created: 2026-08-06
Updated: 2026-08-06

## Goal

Restore automatic hosted Web deployment so the paused-Pulse billing hotfix can
reach production without weakening the database migration safety boundary.

## Proven symptom and root cause

- The Vercel production deployment for the billing hotfix failed before the
  application build.
- The predeploy migration guard rejected
  `20260806170000_hosted_pulse_trial_start_source` because it combined a safe
  nullable-column expansion with a validating `CHECK` constraint.
- Read-only production proof showed that the column, constraint, and Prisma
  migration record are all absent, so no partial production migration needs
  repair.

## Safe rollout proof

- Predeploy adds only the nullable descriptive column. The currently deployed
  app does not write it, so old-code skew produces null.
- Every new application writer accepts the closed
  `HostedPulseTrialStartSource` union or parses Stripe metadata through the
  same closed vocabulary before persistence.
- The postdeploy contract migration checks for unsupported existing values,
  adds the constraint as `NOT VALID`, and validates it only after Vercel has
  promoted the new app and the prior function window has drained.
- The change is Web/database-only; no Cloudflare deployment ordering is needed.

## Tasks

1. Keep the unapplied Prisma migration expand-only.
2. Move the supported-value constraint into an idempotent postdeploy contract
   migration with an explicit production-data preflight.
3. Update focused migration coverage and run the production migration guard,
   Prisma validation, web typecheck, and the affected billing regression.
4. Review, commit, reconcile, push to `main`, and monitor Vercel promotion plus
   the contract-migration workflow.

## Verification log

- Read-only production proof found zero matching columns, constraints, or
  successful Prisma migration records. Existing contract-migration checksums
  matched the checked-in history.
- Focused migration and production-guard suites passed: 46/46 tests.
- Prisma schema validation and web typecheck passed.
- The paused-Pulse billing regression remained green: 58/58 tests.
- The exact expand and contract SQL ran inside a disposable PostgreSQL
  transaction. The constraint was validated, accepted a supported value and
  null, rejected an unsupported value, and the transaction rolled back.
- Migration-focused deep review found no production-breaking issue. It
  confirmed old/new deployment compatibility, bounded table size, and the
  existing contract runner's exact-alias, drain, advisory-lock, timeout,
  rollback, and checksum gates.
- `pnpm verify:acceptance` ran against the exact candidate. All repository
  guards, workspace typechecks, the web production build, and the complete web
  suite passed (8,806 passed, 324 skipped). The command exited nonzero only for
  the same untouched failures as the preceding candidate: one CLI
  participant-binding assertion and six assistant-runtime conversation-shape
  assertions expecting no explicit null session identifier.
- `git diff --check` and the scoped identifier/privacy scan passed.
Completed: 2026-08-06

# Re-arm retention after runner convergence

Status: completed

## Goal

Restore the intended phase-one inbound-content retention drain after the Web
migration was applied before the stamping-capable runner fleet had converged.
Reuse the existing retention wake, cron capacity, and workspace CAS fence.

## Success criteria

- An additive migration re-arms every persisted workspace snapshot, clears its
  prior signal-attempt marker, advances its CAS version, and leaves checkpoint
  time unchanged.
- Focused real-PostgreSQL coverage proves the recovery migration and stale
  checkpoint conflict.
- The deploy runbook records the bounded recovery route.
- Required local verification, specialist review, final review, CI, and
  production aggregate evidence are complete.

## Scope

- `apps/web/prisma/migrations/**`
- Hosted mailbox retention migration tests
- `apps/cloudflare/DEPLOY.md`

## Constraints

- Do not add another dispatcher, queue, or state owner.
- Do not delete or rewrite message content in the migration.
- Keep production evidence aggregate-only and out of repository artifacts.

## Tasks

1. Add the one-shot re-arm migration.
2. Extend static and real-PostgreSQL migration coverage.
3. Document the recovery ordering.
4. Run required verification and review gates.
5. Ship and prove the due queue is draining through the existing cron.

## Evidence

- The exact Cloudflare deployment version and managed-container smoke passed.
- Aggregate production metadata proved the Web migration preceded runner
  convergence and some persisted snapshots checkpointed in that interval.
- Existing hourly retention capacity can drain the bounded snapshot population
  well inside the phase-two waiting gate.
- Static migration checks and the real-PostgreSQL recovery/CAS proof passed.
- The preliminary specialist finding was accepted and resolved by proving both
  an existing future wake and the exact immediate pre-rearm CAS fence.
- Canonical diff verification and the full acceptance gate passed.
- The extended live trace found no unresolved deployment failure; each observed
  checkpoint or accepted-attempt failure recovered to a later checkpoint.
Updated: 2026-07-28
Completed: 2026-07-28

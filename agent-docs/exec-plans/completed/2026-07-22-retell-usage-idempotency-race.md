# Retell usage idempotency race

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Make deterministic hosted AI usage recording safe when concurrent Retell
  lifecycle webhooks report the same terminal provider cost.
- Preserve one immutable usage row and one allowance accounting outcome without
  returning a transient webhook failure for an exact replay.

## Success criteria

- Concurrent exact usage writes converge on the existing immutable row without
  a primary-key error.
- Conflicting reuse of the same usage identity still fails closed.
- Focused regression coverage proves the concurrent-create path and existing
  immutable-record checks.
- Diff-aware verification, required audits, CI, and ReviewGPT pass for the exact
  PR head.

## Scope

- The hosted Web usage persistence primitive and focused usage tests.
- Current hosted Web documentation only if the implementation changes its
  documented idempotency contract.

## Constraints

- Keep Postgres as the single hosted usage owner and preserve deterministic
  usage identity.
- Do not add a queue, lock table, retry lifecycle, or second usage state owner.
- Preserve atomic allowance accounting and immutable-field conflict detection.
- Keep production evidence metadata-only and free of direct member identifiers.

## Tasks

1. Reproduce the primary-key race from concurrent exact usage writes.
2. Replace the race-prone create path with the smallest database-safe
   convergence primitive.
3. Add focused concurrency and conflicting-replay regressions.
4. Run verification, direct proof, required audits, commit, PR, ReviewGPT, and
   CI.

## Evidence

- Production request logs show multiple Retell lifecycle webhook requests in
  the same second; one returned a usage-row primary-key error while sibling
  requests completed.
- Read-only production counts show one deterministic Retell usage row exists
  and was allowance-accounted, proving concurrent convergence lost only at the
  route response boundary.
- The current Prisma `upsert` uses an empty update branch and can execute as a
  read-then-create sequence, leaving concurrent first writers exposed to a
  primary-key conflict.
- The focused real-PostgreSQL interleaving test reproduced that exact `P2002`
  before the fix and passed after the identity-only database upsert branch was
  added.
- The focused hosted usage and Retell suites pass 83 tests. Canonical
  diff-aware Web verification passes 6,126 tests, TypeScript, lint, dev smoke,
  and the production Next build.
- The required coverage-write pass added direct proof that conflicting
  concurrent replay rolls its identity update back and that exact replay keeps
  historical terminal meter state intact. The resulting PostgreSQL suite
  passes all three interleavings with no unresolved coverage finding.
Completed: 2026-07-22

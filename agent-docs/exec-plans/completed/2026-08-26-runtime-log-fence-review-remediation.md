# Runtime-log deletion-fence review remediation

## Objective

Resolve the accepted exact-head ReviewGPT findings on the compatibility
runtime-log deletion-fence PR without adding a service, queue, lifecycle owner,
or second cleanup transaction.

## Scope

- Keep the never-deployed additive fence schema digest-only.
- Document the one permanently retained opaque, raw-identifier-free fence in
  the account-deletion inventory.
- Make the real-PostgreSQL proof exercise the fence-deciding deletion-first race
  and atomic fence-plus-delete rollback before retry.
- Describe the compatibility append ordering on this PR and reserve the early
  zero-checkout proof for the stacked final PR.

## Decisions

- Retain one atomic fence-and-delete transaction. Both compatibility and final
  append paths recheck primary authority under the subject lock, while the
  cleanup receipt retries a rolled-back cleanup; a second transaction and
  checkout do not protect a demonstrated current path.
- Do not change account-deletion UI copy. The durable store inventory is the
  precise retention contract, and the existing farewell already describes
  deletion as removal of live data.

## Verification

- Focused runtime-log, migration, and account-data store tests.
- Opt-in real-PostgreSQL runtime-log concurrency suite.
- Isolated runtime-log Prisma validation.
- Hosted Web typecheck, docs drift, and diff checks.
- Substantive final ReviewGPT round 2 on the exact pushed remediation head.

## Status

- [x] Validate and disposition the preliminary and final ReviewGPT findings.
- [x] Apply the accepted schema, inventory, coverage, and documentation changes.
- [x] Complete focused verification.
- [x] Prepare the candidate for exact-head final ReviewGPT round 2.
Status: completed
Updated: 2026-08-26
Completed: 2026-08-26

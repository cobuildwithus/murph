# PR 1015 permission-decision revision

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Preserve retry of a Linq group-offer receipt whose acceptance transaction did
  not commit, but only while no newer authenticated membership or sharing
  decision exists.
- Ensure an explicit Web permission submission supersedes the older receipt
  even when the selected shares were already absent or revoked and the
  submission therefore changes no share row.

## Proven cause

- The pending receipt captures the exact membership id and a hash of current
  selected-share rows.
- A supported authenticated permission submission may intentionally leave an
  already-absent scope unchecked. That newer denial changes neither membership
  nor share rows, so the old receipt's snapshot still matches.
- Exact provider redelivery can then apply the older grant after the newer
  explicit denial.
- Final ReviewGPT round 2 reproduced this state-equivalent authority gap and
  classified it as review-induced.

## Constraints

- Keep the existing provider-event receipt as the pending-effect owner.
- Keep receipt-before-acceptance rollback retry for unchanged authority.
- Advance one canonical group-membership decision revision for every committed
  group acceptance or explicit permission submission, including no-op denial.
- Reuse membership identity to fence leave/rejoin and member creation.
- Remove the selected-share snapshot once the orderable decision revision owns
  supersession; do not add a table, service, queue, ledger, or reconciliation
  path.
- Legacy or malformed claims fail closed.

## Approach

1. Add a nullable integer sharing-decision revision to the existing group
   membership row. Treat null only as the legacy baseline zero, and write one
   on the next explicit decision without requiring a backfill.
2. Version the pending claim and capture the current membership id plus its
   decision revision in the provider-event receipt transaction.
3. Initialize or increment the revision in every committed group-acceptance
   transaction. That includes authenticated Web permission submissions for an
   existing membership even when no share row changes. Increment the same owner
   for the explicit email-share revocation path.
4. On pending retry, compare membership identity and revision under the existing
   locks. A mismatch terminally supersedes the receipt; an exact match retains
   the existing retry behavior.
5. Add the required real-PostgreSQL no-op-denial regression and retain the
   unchanged-authority, applied-confirmation, revoked-offer, and leave/rejoin
   proofs.

## Verification

- Focused unit and migration tests.
- Real-PostgreSQL no-op denial/retry regression plus existing replay suite.
- Hosted Web typecheck.
- `pnpm test:diff <all changed paths>`.
- `pnpm verify:acceptance`.
- Parent final review, then exact-head ReviewGPT correction round 3 concurrent
  with CI.

## Evidence to date

- Final ReviewGPT round 2 on exact head
  `1c06d4dfd4c88263d16c3a57b3d42149c25f6db0` returned
  `RETROSPECTIVE_REQUIRED`: a later authenticated no-op denial left the
  membership/share snapshot unchanged, so redelivery could restore authority.
- The new real-PostgreSQL regression failed before the correction: exact
  redelivery restored both profile-name and sleep-times grants on the original
  membership after the newer no-op denial.
- The first non-null/default migration shape was rejected by the production
  predeploy migration guard. It was replaced with a nullable expansion and a
  code-owned null-as-zero baseline, avoiding a backfill or multi-phase lifecycle.
- The production migration wrapper applied the corrected expansion to a fresh
  isolated local database.
- The focused five-suite in-memory run passes all 212 tests.
- The full real-PostgreSQL replay suite passes all 9 tests, including an
  explicit revision advance from two to three for the no-op denial and terminal
  supersession with the share still revoked.
- Hosted Web typechecking and agent-doc drift checks pass.
- The disposable local proof database was removed after verification.
- Canonical local diff verification passes for every changed schema, source,
  test, migration, and durable-doc path, including the full hosted Web lane and
  production build.
- Full local acceptance passes on rerun across package coverage and both app
  verification/build lanes. The first attempt exposed two unchanged timing
  failures: the setup-wizard Venice completion case and the 1 ms hosted
  preference handoff timeout case. The Venice case passed its exact focused
  rerun; the handoff test and implementation are unchanged from the base and
  the complete Web lane had already passed twice before the green acceptance
  rerun.

## Deployment

- Apply the additive schema migration before Web instances read or write the
  versioned pending claim.
- The versioned state keeps old and new application instances fail-closed
  during rollout.
Completed: 2026-07-27

# Meal-photo schema-v1 revocation generation

Status: completed

## Outcome

Prevent a schema-v1 meal-photo enrollment whose crypto preparation started
before a completed revocation from retrying against the revoked row and
reactivating automatic capture. Preserve immediate schema-v1 enrollment only
for a request that begins after the latest revocation generation.

Product UX: Patch.

- Outcome: completed automatic-capture revocation remains authoritative over an
  older in-flight enrollment.
- Reaches: existing foreground schema-v1 enrollment and identity-authenticated
  revocation.
- Proof: deterministic delayed-preparation concurrency coverage plus the
  existing production-crypto composition and enrollment suites.

## Protected invariants

- Provider/KMS work finishes before database checkout and member-row locking.
- Revocation remains credential-free and durable for missing, already-revoked,
  and enabled rows.
- The existing enrollment row remains the only authority owner; add no queue,
  state manager, service, or general abstraction.
- One bounded full reprepare remains valid only for exact winner/root drift.
- A request prepared before the current revocation generation fails closed;
  one started afterward may explicitly re-enroll under schema-v1 compatibility.
- Test composition must mock external crypto edges without production branches
  that exist solely for tests.

## Evidence and owner

- PR #2365 is an open draft; the clean local head and pushed head were both
  `f60dbdc2fc39ca6f7ae1142aef331f2ca66c7f4b` before remediation.
- `issueMealPhotoCaptureEnrollment` prepares before the member lock and retries
  every `HostedDomainRootPreparationMismatchError` once.
- Schema-v1 revocation currently leaves no new exact durable fact for a missing
  or already-revoked row, and enrollment preparation snapshots revision zero.
- A delayed preparation can therefore observe the later tombstone on retry and
  install a fresh active schema-v1 credential.
- `HostedMealPhotoCaptureEnrollment.id` has no dependent relation and revoked
  rows clear the ciphertext whose AAD binds that id, so advancing the id is the
  smallest existing-row generation seam without schema or another owner.

## Requirement retrospective

- Original requirement: keep KMS and secure-box provider work outside the
  database transaction while preserving the existing enrollment and revocation
  authority contract.
- First-reviewed shape: the pushed head split preparation from the short
  member-locked transaction and retried one typed preparation mismatch, but a
  revision-zero revocation did not leave a new durable fact for that retry to
  distinguish from the state it had prepared.
- Current shape: retain that split phase, use the existing row ID as the exact
  revision-zero revocation generation, classify that generation mismatch as an
  authority conflict, and delete the production test-codec branch. The
  remediation changes 114 authored-source lines of the one existing owner and
  adds no schema, owner, queue, retry layer, or service.
- Decision: continue with the owner-local correction. Reverting would restore
  provider work under the member lock; adding a new revision column or
  revocation ledger would duplicate authority. Rotating the credential-free
  row ID is the smallest durable correction because the cleared ciphertext is
  the only field whose AAD depends on it.

## Implementation

1. Snapshot the exact enrollment generation during preparation and distinguish
   authority-generation drift from re-preparable root/winner drift.
2. Advance the existing row id for every completed schema-v1 identity
   revocation, including missing and already-revoked state, while retaining a
   credential-free revision-zero tombstone.
3. Make a generation mismatch non-retryable so an older prepared request cannot
   acquire a fresh post-revocation generation.
4. Remove the production test-codec enrollment branch and adapt unit tests by
   mocking the prepared-root and local secure-box edges.
5. Add deterministic delayed-preparation coverage for fresh enrollment,
   existing-root prewarm, repeated revocation, and revoked-enabled-revoked ABA;
   add real-PostgreSQL member-lock proof when the existing opt-in lane supports
   it without new harness machinery.

## Verification

- Focused enrollment behavior, crypto-boundary, and production-composition
  suites passed 37 tests.
- The isolated local-PostgreSQL concurrency suite passed all eight tests,
  including the real blocked member-lock generation rotation.
- Hosted Web prepared typecheck, touched-file ESLint, `pnpm docs:drift`,
  `git diff --check`, privacy/identifier scan, and final diff review passed.
- Exact-head preliminary and final ReviewGPT, PR CI, merge, and deployment proof
  remain completion follow-through.

## Deployment concerns

Web-only behavior correction with no schema change. Old and new Web functions
remain compatible with the same row shape; mixed functions may still expose
the old schema-v1 race until old functions drain. Deploy the fixed Web artifact
normally, then confirm no enrollment authority conflict or meal-photo upload
regression in bounded logs.
Updated: 2026-08-27
Completed: 2026-08-27

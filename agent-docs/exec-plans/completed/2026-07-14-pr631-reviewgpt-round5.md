# PR 631 ReviewGPT Round 5 Fixes

Status: completed
Updated: 2026-07-14

## Goal

Close the three accepted exact-head ReviewGPT findings without widening the
dormant Clinical Records backend into the later UI or retry/reconnect slice.

Success means an active run owns an immutable authorization-scope snapshot,
pagination identity never normalizes provider link text, and malformed UTF-8
provider responses fail closed before parsed or persisted clinical data exists.

## Constraints

- Keep credentials and current authorization state connection-owned, while
  checkpoint/provenance identity remains immutable for a created run.
- Keep exact provider link text distinct from the parsed URL used for network
  policy and reject surrounding ASCII whitespace at the validation boundary.
- Preserve byte accounting and existing provider-response error semantics while
  rejecting malformed UTF-8 before JSON parsing.
- Add the smallest schema migration and focused proof; do not add a queue,
  retry generation, compatibility service, or user-facing activation surface.

## Implementation

1. Snapshot granted scopes on `ClinicalRecordRetrievalRun` at creation and read
   run descriptors from that immutable field across refresh/preemption.
2. Hash exact page URL strings without trimming and reject leading/trailing
   ASCII whitespace before URL parsing or provider fetch.
3. Decode SMART and FHIR JSON response bytes with fatal UTF-8 semantics and map
   failures to the existing invalid-provider-response boundary.
4. Add focused refresh/resume, raw-link whitespace/identity, and malformed-byte
   regressions.

## Verification

- Prisma generate/validate and migration-guard proof.
- Focused web retrieval/SMART, assistant-runtime checkpoint/resume, and package
  helper tests plus affected TypeScript 7 typechecks.
- Required security/privacy and coverage-write completion audits.
- Push the PR-specific fix, run CI and one new exact-head ReviewGPT round, and
  require zero accepted findings.

## Deployment Compatibility

The feature remains dormant. The additive run-scope column must deploy with the
web build before later activation; no old producer exists in production, so no
legacy active run requires a compatibility shim or backfill path.
Completed: 2026-07-14

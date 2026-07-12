# Ingest WHOOP HealthKit recovery and strain metadata

Status: completed
Created: 2026-07-09
Updated: 2026-07-09

## Goal

- Recover the WHOOP Recovery score and per-workout Strain values that exist
  only as custom metadata on Apple Health objects, then ingest them through
  Murph's existing hosted device-sync and canonical vault ownership path.

## Success criteria

- The iOS companion reads only the approved sleep/workout HealthKit objects,
  extracts only the two supported numeric metadata fields, and never logs or
  persists their values locally.
- Authenticated, consented members can upload a bounded, validated batch.
- Replayed or overlapping batches are idempotent on stable source identity.
- Hosted execution imports the batch through importers and packages/core so
  recovery and workout-strain appear as existing canonical metric families.
- Focused iOS and Murph tests, required typechecks, privacy/security review,
  and a direct synthetic end-to-end scenario pass.

## Scope

- In scope: a narrow native HealthKit metadata reader; one authenticated
  companion upload contract; reuse of the existing encrypted dirty-payload,
  hosted device-sync, importer, and core write path; documentation and tests.
- Out of scope: Bluetooth, a general native HealthKit sync engine, sleep-stage
  inference, HRV/temperature recovery, arbitrary metadata upload, a new
  provider registry entry, or local health-data persistence.

## Constraints

- Technical constraints: packages/core remains the only canonical writer;
  apps/web must not become a health-fact store; uploads and stored handoffs are
  bounded and replay-safe; no health values in logs or analytics.
- Product/process constraints: keep the companion thin and the exception
  limited to data Junction demonstrably drops; preserve the unrelated iOS auth
  work in the primary checkout; use isolated branches and PRs.

## Risks and mitigations

1. Risk: undocumented metadata keys could disappear or change type.
   Mitigation: accept only finite numeric values in documented ranges, skip
   unsupported objects safely, and keep Junction data as the baseline path.
2. Risk: sleep fragments repeat the same Recovery value.
   Mitigation: collapse them deterministically before upload and use stable
   source identity plus core revision/idempotency semantics server-side.
3. Risk: a new native path becomes a parallel sync engine.
   Mitigation: query only sleep/workout metadata, retain no anchors or local
   database, and route canonical writes through the existing device-sync path.

## Tasks

1. Trace and choose the existing hosted dirty-payload/import boundary.
2. Define and validate the bounded companion metadata batch contract.
3. Add importer/core-path normalization and replay/idempotency tests.
4. Add the authenticated web route and hosted handoff tests.
5. Add the narrow HealthKit reader and app/API orchestration in the iOS repo.
6. Run required verification, specialist audits, direct proof, and PR gates.

## Decisions

- Do not write canonical health facts directly from apps/web.
- Do not introduce a new first-class wearable provider for this narrow relay.
- Use existing metric names `recovery-score` and `workout-strain`.
- Treat the native upload as best-effort enrichment; ordinary Apple Health
  syncing and backend-confirmed connection state remain independent.
- Treat WHOOP-named HealthKit metadata as an unverified provider hint, not
  attested WHOOP provenance, because HealthKit metadata is app-writable.
- Map workout strain to activity observations instead of synthetic workout
  sessions so the enrichment cannot create duplicate workouts.
- Cap pending encrypted companion batches per connection inside the existing
  connection mutation lock and reject excess work with a retryable response.

## Verification

- Focused importer tests passed (3 tests).
- Full device-syncd tests passed (40 files, 721 tests).
- Focused web tests passed (77 tests), including auth/consent, strict schema,
  timestamp horizons, queue bounds under lock, and encrypted wake staging.
- A full isolated `apps/web` verification passed: dev smoke, 4,038 tests,
  lint with no errors, typecheck, and production build.
- Affected web, device-syncd, and importer typechecks passed.
- iOS generation and formatting checks passed; the full simulator suite passed
  51 tests, including extraction, range/type validation, deduplication,
  chunking, independent per-kind cursor orchestration, and cancellation.
- Security/privacy review and the fresh post-fix re-review found no remaining
  findings. Coverage review added exact boundary and cancellation cases.
- The broad workspace acceptance lane reached unrelated timing failures under
  concurrent load; all affected packages and the isolated web verification
  passed independently.
Completed: 2026-07-09

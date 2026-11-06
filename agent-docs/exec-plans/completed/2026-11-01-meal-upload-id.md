# Prepare meal upload identifier readers

Status: completed
Created: 2026-11-01
Updated: 2026-11-01

## Goal and scope

Ship the compatible readers required before phone upload identifiers can be written. The follow-up writer remains a separate authorized task after runtime convergence. No image delivery, new storage owner, backfill, member messaging, production data reads, or iOS edits.

## Decisions

- Manual uploads already send a lowercase UUID in Idempotency-Key. Automatic captures already send their stable capture ID in that header. Preserve those opaque values.
- Manual thumbnail lookup uses the existing iOS SHA256("manual:" + lowercase UUID) function; automatic lookup uses uploadId directly. No upload request change.
- Persist one optional canonical meal field. Existing direct import creates the exact meal Murph later enriches; no timestamp association.
- Existing canonical records and nested capture wakes have strict schemas. Ship readers first, converge runtime, then ship writers in a second PR. This avoids a permanent flag or mixed-version rejection. Keep the reader release as the rollback floor after writes begin.

## Reader release and follow-up

1. Reader release: optional canonical/wake field, nullable projection, list/detail and tombstone proof; local focused tests/typechecks, contract artifact generation, parent review, ReviewGPT, exact-head CI, merge, Web and runtime deploy.
2. Writer release: preserve upload header, encrypted wake, canonical import; synthetic composed upload/import/projection/API proof and retry/non-upload cases.
3. Update iOS contract and deployment guide; run focused proof, typechecks, complexity and doc guards; complete ReviewGPT/CI/merge/deploy.

## Product UX

Replay manual and automatic photos with retained local thumbnails, missing local thumbnail, typed/texted/older meals, retry and removal. Null always means a plain tile; no server image access. Read freshness and optimistic removal remain unchanged.

## Evidence

Focused tests passed: 4 wake parser cases, 4 projection cases, 2 real-vault removal cases, 30 Web route cases. Contracts, hosted-execution, query, assistant-runtime and Web typechecks passed. Contract schema regenerated. Parent review confirms no production writer populates uploadId in this release. Product UX: Ready for reader-only rollout; actual thumbnail linkage awaits the writer. ReviewGPT, exact-head CI and deploy checks remain shipping gates. Other sessions own their review lanes; wait/retry collisions.
Completed: 2026-11-01

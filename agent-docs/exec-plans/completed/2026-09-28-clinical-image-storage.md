# Preserve clinical evidence during explicit image cleanup

Status: completed
Created: 2026-09-28
Updated: 2026-09-28

## Outcome and ownership

An explicitly authorized repair can omit exact embedded image payloads reviewed
as nonclinical from linked HTML documents. The vault-usecases clinical owner
validates the immutable manifest and eligible FHIR parent. Core owns the atomic,
audited raw replacement and checks its exact preimage. No classifier, background
job, provider call, database field, or member mutation endpoint is added.

## Invariants and deployment

Lossless UTF-8 and identical extracted clinical text are required. Unknown image
payloads remain; inline FHIR copies are rejected. A bounded versioned raw receipt
binds original source identity, retained bytes, text digest and removed digests.
Readers share the canonical lock. Enrichment binds fresh model output to retained
bytes, while frozen proposals and canonical facets keep original source identity.
Original-input retries reuse verified retained bytes without restoring images.

Deploy compatible readers before any explicit repair. Older readers fail closed
on repaired documents; reverting below this reader version requires restoring
original evidence first through an authorized repair. Original source archives
remain outside the repair copy. No automatic mutation happens on deployment.
Private evidence and visual reviews stay outside repository artifacts.

## Product UX and evidence

Ready: ordinary imports remain unchanged; explicit repair saves storage without
changing clinical text or canonical records. Unknown images and inconsistent
source evidence are retained or rejected. There is no new UI.

98 tests across clinical-document-storage, clinical-records-execution,
clinical-enrichment, and clinical-enrichment-parent pass. Core and vault-usecases
typechecks pass. Tests cover exact payload selection, unknown image retention,
unchanged manifests/text, idempotency, malformed and orphan receipts, fresh and
frozen extraction, provider retry, and raw preimage enforcement. Complexity guard
passes; the largest new function scores 16. Parent source review is complete.
Completed: 2026-09-28

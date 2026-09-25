# Epic linked document acquisition and complete chart batching

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Connecting an Epic hospital should retrieve useful document bodies as well as their listings across all available years, and preserve progress across large charts.

## Outcome and protected invariants

The feature is unlaunched and has no existing imports. Preserve patient-bound authorization, immutable original evidence, deterministic source revisions, explicit incomplete coverage, and bounded memory/provider requests. No migration or compatibility machinery for nonexistent records.

## Existing owners and proven gaps

Web owns credentials, provider allowlists, run authority and request claims. Hosted execution owns signed transport; runtime owns resumable work; vault-usecases owns canonical raw persistence; clinical-records/importers own provenance and clinical mapping. Current searches omit document categories, linked Binary bodies are never fetched, and the single 32 MiB snapshot discards an unfinished slice. Existing text-only single-attachment mapping ignores reports with multiple or binary attachments.

## Scope and implementation

1. Extend the existing Epic catalog with verified patient-facing document searches and supporting read registrations/scopes.
2. Issue encrypted exact-parent attachment tickets from validated FHIR pages. Fetch only authorized same-base Binary resources, plus the bounded DiagnosticReport Media-to-Binary study-image hop, through the existing Web control boundary, with streaming limits and no redirects.
3. Preserve every attachment's original bytes and immutable parent binding separately from untouched FHIR pages. Extract supported text using existing owners; make unavailable/unreadable content explicit.
4. Import bounded batches with proven pagination continuity and durable progress. Never infer absence from partial coverage or overwrite the same source revision with a partial note.
5. Verify synthetic composed happy/retry/denied/large-chart flows, relevant typechecks, exact-head CI and ReviewGPT. Keep one root completion owner.

## Product UX

Effort: feature. Entry remains the authorized hospital connection; no extra document selection. New members with small/large charts receive saved evidence and readable notes, including multiple attachments. Partial grants, missing/oversized bodies, token expiry, provider errors, and foreground interruption preserve saved progress with honest status. Hospital-exposed FHIR data is the acquisition boundary; unavailable provider history, DICOM image archives, ongoing monthly refresh, and production launch are separate work.

Done when supported document bodies are reachable through the wired production import path and composed tests prove raw readback, text usability, isolation, and resumable batching. Review status: Hold during implementation.

## State and failure decisions

Reuse private portable clinical checkpoints and immutable raw manifests. Provider tokens stay Web-owned; encrypted tickets are scoped to the same run/generation and attachment. No new scheduler, service, or canonical document identity owner. Per-call limits remain; large-chart continuation must not silently truncate after a single batch. Parser failure preserves source bytes and incomplete semantics.

## Verification

Run focused clinical-records/importer/vault/runtime/Web/Worker tests and relevant typechecks; use real existing Poppler extraction on a synthetic PDF and a real-Codex source-note readback journey. Check authorization loss, stale/cross-member tickets, redirects, malformed bytes, missing/duplicate attachments, source revision replay, and page/batch boundaries. Start required ReviewGPT on the stable pushed head concurrently with CI. Reconcile accepted findings under the continuing user authorization.

## Progress

- Independent research and implementation delegated by non-overlapping owner scopes; root owns integration, parser reuse, documentation and completion.
- Existing immutable source evidence and checkpoint seams selected; exact batch contract and linked-document transport are implemented.
Completed: 2026-09-10

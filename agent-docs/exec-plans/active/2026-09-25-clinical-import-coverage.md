# Correct clinical import coverage and reference-only reporting

Status: active
Created: 2026-09-25
Updated: 2026-09-25

## Outcome and invariants

Report saved records, portal coverage limits, and repeated processing honestly.
Preserve supported qualitative laboratory results and their original range
context without inventing values or units. Preserve dated unmapped observations
as exact source notes; recover private local data only through canonical APIs.
Keep uncertain clinical absence,
unknown provider warnings, malformed ranges, and denied access fail-closed.

## Owners and evidence

The clinical-records warning classifier serves both retrieval status and
clinical absence; its callers need distinct notice handling. The importer
rejects a text result whenever its reference range has numeric bounds. Core's
skipped count includes repeated hold markers, so Web cannot label every skip
as an existing result. Synthetic source replays reproduce these boundaries.
Model enrichment already processes downloaded documents; unsupported structured
observations are not admitted to that document-only lane.

## Smallest change

Reuse the warning classifier with an explicit retrieval-only option for known
Epic notices. Keep the default conservative for allergy absence. Preserve
qualitative reference ranges as bounded source text through the existing
referenceRange.text field. Reuse the existing source-note owner for unmapped
observations with explicit clinical dates, without normalizing their values.
Clarify existing Web status and skip labels. The product change adds no database
fields, protocol counters, model calls, queues, or credentials.

## Product UX

Outcome: members can distinguish saved results from portal limits and repeated
items. Entry: existing Medical records page. Cover completed imports, partial
coverage, actual retrieval failure, zero-added runs, and reference-only items.
Use synthetic production components at phone and desktop widths. Do not expose
provider diagnostics, credentials, or private record content in the UI.

## Failure and compatibility

Old callers retain conservative warning handling. New retrieval callers ignore
only exact Epic warning codes for no results and patient-access notices;
unknown or mixed warnings remain partial. Existing raw manifests and canonical
schemas remain readable. Historical run outcomes are not rewritten. Invalid,
qualified, conflicting, or oversized ranges remain held. Fresh authorized
imports can use the existing corrected care-plan query; no automatic live replay.

## Tasks and proof

- Inspect registration when computer access is available; never silently widen permissions.
- Add focused classifier, importer, runtime, and UI regression coverage.
- Verify the model routing explanation against its current caller.
- Run owner tests, typechecks, complexity checks, and synthetic rendered proof.
- Review the full diff, update durable owner documentation and changelog, and commit.

## Progress

- Diagnosis and read-only production registration inspection complete; the affected
  outside-record APIs are already registered. Provider access remains a separate limit.
- Focused importer tests pass, including exact-source notes, qualitative ranges,
  conservative allergy absence, and explicit recovery/replay of prior hold markers.
- Phone and desktop rendered proof passes with production components.
- Private local recovery is running against a separate archive copy, using the
  authorized Luna model, independent source review, canonical mutation and readback.
  The original archive and live vault remain unchanged. No private evidence is
  copied into repository artifacts.
- Source-note recovery and normal import replay pass without source-revision conflicts.
  The integrity comparison preserves original raw bytes and unrelated canonical records.
- The whole-vault validator has pre-existing export findings and rejects valid clinical
  manifests under the generic raw schema. A synthetic initialized-vault reproduction
  confirms this owner mismatch; tracked in the task-owned Frog entry. Focused clinical
  attestation and canonical readback remain the relevant recovery proof.
- Focused checks: importer 128, clinical contracts 52, runtime 37, vault execution 31,
  Web records 27, and changelog 46 tests pass. Relevant package and Web typechecks pass.
  Complexity passes across six changed source files; importer debt falls by one and
  the existing three hotspots do not increase. Their current ownership remains clear.
- Remaining: finish bounded local document extraction, complete final canonical and
  source verification, package the private recovery copy, and commit the reviewed code.

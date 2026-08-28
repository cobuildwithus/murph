# Remediate sample CLI recovery review findings

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Keep CSV recovery useful without ever presenting data rows, wrong-delimiter
  rows, or truncated header fragments as selectable CLI column names.
- Make batch-show help describe the exact list-to-show id contract it accepts.

## Product UX Patch

- Outcome: the model receives truthful, bounded CSV repair guidance and never
  mistakes private row values or truncated text for an exact flag value.
- Reaches: failed `samples import-csv`, `samples csv import`, and `samples csv
  profile` inference, plus `samples batch show` help and model metadata.
- Proof: importer and final CLI envelopes cover headerless, wrong-delimiter,
  long-header, and wide-header inputs with non-echo and exact-token assertions;
  batch help retains the legacy list-to-show round trip without transform-only
  wording.

## Foundation And Scope

- Resume the existing draft PR branch at its exact reviewed head.
- Implement only the two accepted preliminary specialist findings.
- Keep the shared Vault CLI error transport, service graph, and PR metadata
  unchanged; do not push or rerun ReviewGPT in this delegated remediation.

## Constraints

- A CSV row is eligible to supply header repair tokens only when importer-owned
  evidence confirms it behaves as a header for a later data row.
- Every surfaced header token must be complete, schema-like, and part of a
  complete expected string that fits the shared repair-field budget.
- When trust or budget proof fails, omit header values entirely and name only
  existing delimiter and column-selection flags.
- Never expose raw cells, shortened header fragments, paths, or arbitrary
  importer error context.
- Preserve exact equality lookup for batch ids and avoid new state or services.

## Tasks

1. Replace truncated CSV-header diagnostics with one pure trust/budget gate at
   the importer owner.
2. Route timestamp and value inference failures through the gated diagnostic.
3. Correct batch-show help and regenerate tracked CLI metadata.
4. Add importer and final-envelope regressions for every accepted edge case.
5. Run focused tests/typechecks, privacy and diff checks, then archive this plan
   in a scoped local commit.

## Verification

- Focused Importers tests for trustworthy exact headers, headerless rows,
  wrong delimiters, long headers, wide headers, and non-echo behavior.
- Focused CLI final-envelope tests for the same safety and repair contract.
- Focused CLI help/model-metadata test plus the existing `import_alpha`
  list-to-show round trip.
- Importers and CLI typechecks, CLI surface generation, `git diff --check`, and
  identifier/value/credential privacy scans.

## Result

- A single importer-owned repair context now surfaces exact header names only
  after a later row proves a recognized timestamp or sample column, every name
  is schema-like, and the complete expected string fits 160 characters.
- Untrusted, unsafe, long, and wide headers now omit all tokens and direct the
  model to `--delimiter` plus the applicable column-selection flags.
- Batch-show help and generated model metadata describe the exact id returned
  by batch list, while the existing `import_alpha` round trip remains green.
- Importers and CLI typechecks passed. Two focused Importers files passed 53
  tests, and the three focused final-envelope/help/batch CLI tests passed.
- CLI surface generation, `git diff --check`, and the identifier/path/credential
  privacy scan passed. No new repository friction qualified for Frog logging.
Completed: 2026-08-24

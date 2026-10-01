# Make sample CLI failures model-repairable

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Replace silent or generic sample-import failures with bounded, value-free
  repair details that tell the model which field or CLI flag to correct.
- Preserve atomic writes and make every batch id returned by `samples batch
  list` valid input to `samples batch show`.

## Product UX Patch

- Outcome: the model can correct a malformed JSON sample batch or CSV command
  from the final machine error without inspecting private input values.
- Reaches: existing `samples import-json`, `samples import-csv`, `samples csv
  import`, `samples csv profile`, and batch list-to-show journeys.
- Proof: final CLI envelopes expose indexed fields, exact repair flags, bounded
  header/skip summaries, and no raw cell values; a rejected JSON batch leaves
  canonical sample storage unchanged.

## Foundation And Overlap

- Base the work only on the exact open Vault CLI error-foundation head that
  introduced the bounded repair contract and final error projection.
- Keep the shared transport and projection foundation unchanged.
- No other open pull request overlaps the sample importer, sample command
  helpers, or sample use-case paths in this plan.

## Scope

- Reject non-object members of `samples[]` before loading the write runtime and
  report each bounded indexed path.
- Preflight model-fixable sample fields so downstream contract failures retain
  their sample index and field in the structured repair envelope.
- Surface all-invalid CSV skip-reason counts and inference recovery through
  exact flags and bounded header names without exposing data cells.
- Correct the shared CSV runtime failure label for each command entrypoint.
- Relax only the batch-show argument validation needed to accept exact ids that
  batch-list already emits; lookup remains exact and never becomes a path.

## Constraints

- Use the foundation repair contract as the sole model-facing structured error
  detail. Do not forward arbitrary error context, payloads, raw cells, or
  absolute paths.
- Validate an entire JSON batch before any canonical write can begin.
- Preserve existing successful import and canonical-id behavior.
- Do not add dependencies or broaden shared transport behavior.
- Do not push, open a pull request, or run ReviewGPT in this delegated package.

## Tasks

1. Add value-free JSON sample validation and indexed repair fields at the
   sample use-case boundary.
2. Add a narrow safe CSV diagnostic error at the importer owner and translate
   it into the foundation repair contract in the CLI helper.
3. Align batch show input with batch list output and correct CSV command labels.
4. Add focused final-envelope, non-echo, no-partial-write, importer, and batch
   journey regressions.
5. Run focused tests and package typechecks, inspect the final diff and privacy
   scan, then archive this plan in the scoped task commit.

## Verification

- Focused Vault Usecases/CLI integrated JSON import tests for indexed repair,
  mixed-member rejection, non-echo, and unchanged canonical sample state.
- Focused Importers tests for bounded skip counts and exact inference flags and
  header names.
- Focused CLI tests for final CSV envelopes, correct command labels, non-echo,
  and the batch list-to-show round trip.
- Typecheck each changed package owner.
- `git diff --check`, generated CLI artifact verification if command schemas
  change, identifier/privacy scan, and added/deleted LOC accounting.

## Result

- Rebased without conflict onto the exact updated error-foundation head before
  final verification.
- Core and Vault Usecases typechecks passed after the final indexed-error
  implementation; Importers and CLI typechecks also passed.
- Focused Core import tests passed (7), Importers tests passed (29), and the
  final CLI JSON, CSV, batch, and command-label journeys passed (5).
- The CLI surface generator completed and refreshed only the tracked skill hash.
- A combined three-file CLI run also passed all sample tests, then an unrelated
  audit-command test in the selected file reached its existing 60-second test
  timeout. Every changed sample journey passed again in isolated final runs.
- `git diff --check` and the value/path/credential privacy scan passed.
Completed: 2026-08-24

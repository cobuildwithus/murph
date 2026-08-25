# PR 2206 current-main integration

Status: active
Created: 2026-08-25
Updated: 2026-08-25

## Goal

Ship the sample JSON/CSV recovery slice on current `main` while preserving one
shared error projector and no partial writes or submitted-value echo.

## Evidence

- PR 2206 round one found that CSV inference serialized unvalidated row-zero
  cells into model-facing repair output.
- Round two proved removal of raw header/cell serialization, atomic invalid
  imports, and batch list-to-show compatibility, then returned
  `ROUND_OUTCOME: PASS`.
- The later foundation integration has local proof but has not received a
  post-`main` exact-head ReviewGPT round.

## Design

- Current `main` owns shared projection, CLI guidance, and generic diagnostics.
- Sample/importer owners retain only their finite public-field mappings and
  pre-write validation.
- Regenerate CLI artifacts and compose the measured lazy bundle allowance; add
  no registry, repair channel, retry manager, state owner, or compatibility
  layer.

## Tasks

1. Merge current `main`, resolving duplicate foundation history by ownership.
2. Prove the resulting tree is current `main` plus only the samples slice.
3. Run focused tests, affected typechecks, prepared/package-shape checks, docs
   gates, and production runner bundle/parity proof.
4. Push the exact candidate, update the PR contract, and run the sensitive
   post-integration ReviewGPT round with the prior finding ledger.
5. Resolve any accepted finding, close the plan, admit the PR to CI, and merge.

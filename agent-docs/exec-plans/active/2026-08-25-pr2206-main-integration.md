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
- Current `main` was merged at `96c70a3d64`; the resulting tree differs from
  `main` only in the samples/import slice, its authored plan history, and the
  measured bundle allowance.
- Focused verification passes: 268 sample and shared-boundary tests, 14 runner
  bundle tests, all six affected package typechecks, prepared runtime, CLI
  package shape, and both docs gates.
- Canonical runner assembly passes all eight parity probes. The Vault CLI is
  9,502,535 bytes against a 9,508,867-byte budget; the runner is 11,335,561
  bytes against an 11,393,617-byte budget.
- Round three found that the current-main integration preserved only primitive
  types for correctly typed semantic failures. The finding is accepted: the
  existing finite sample mapper will retain fixed value-free constraints while
  the shared projector remains unchanged.
- The round-three remediation covers negative and fractional heart rate,
  invalid timestamps, zero and fractional sleep duration, invalid sleep stage,
  and incompatible units. Focused use-case and command tests prove value-free
  repair hints, zero sample or batch writes, and an unchanged audit-record
  count; affected typechecks and the 14-test runner bundle suite pass.
- The first post-remediation assembly exposed a 60-second probe-harness timeout:
  the same unbundled command completed successfully in 68.37 seconds under
  transient host contention and 57.43 seconds on a warm repeat. The existing
  probe boundary now uses a finite 120-second behavioral timeout and reports a
  bounded timeout/error code, signal, and configured limit instead of generic
  `spawn_error`; the canonical rerun then passed every probe.

## Design

- Current `main` owns shared projection, CLI guidance, and generic diagnostics.
- Sample/importer owners retain only their finite public-field mappings and
  pre-write validation.
- Runner assembly retains one probe boundary; its timeout is a behavioral-test
  ceiling rather than a startup performance contract, and its diagnostic uses
  only bounded process metadata.
- Regenerate CLI artifacts and compose the measured lazy bundle allowance; add
  no registry, repair channel, retry manager, state owner, or compatibility
  layer.

## Tasks

1. [done] Merge current `main`, resolving duplicate foundation history by ownership.
2. [done] Prove the resulting tree is current `main` plus only the samples slice.
3. [done] Run focused tests, affected typechecks, prepared/package-shape checks, docs
   gates, and production runner bundle/parity proof.
4. Push the exact candidate, update the PR contract, and run the sensitive
   post-integration ReviewGPT round with the prior finding ledger.
5. Resolve any accepted finding, close the plan, admit the PR to CI, and merge.

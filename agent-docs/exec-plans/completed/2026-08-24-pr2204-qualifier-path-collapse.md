# PR 2204 scheduled-log qualifier path collapse

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

Prevent `scheduled-log import-json` validation from exposing a submitted
measurement qualifier key through a model-facing field-error path while
preserving precise recovery at the safe `qualifiers` container.

## Evidence

- Import validation currently preserves identifier-shaped issue-path segments.
- Zod appends a rejected record key after
  `action.measurements.<index>.qualifiers`, so an identifier-shaped private key
  can survive into the model error envelope.
- The scheduled-log command already owns surface-specific validation-path
  mapping before the shared error projector.

## Product UX patch

- Outcome: an assistant learns which qualifier container to correct without
  receiving the submitted qualifier key or value.
- Reaches: `scheduled-log import-json` with an invalid measurement qualifier;
  typed `scheduled-log save` recovery remains mapped to
  `measurementQualifier`.
- Proof: a full JSON CLI envelope uses an identifier-shaped private qualifier
  key, asserts the safe container path, proves key/value non-disclosure, and
  snapshots the complete vault to prove no scheduled-log or audit write.

## Tasks

1. Tighten the regression so the current identifier-shaped path leak is
   reproduced through the full model-facing envelope.
2. Collapse import validation paths at the measurement `qualifiers` container
   before issue projection, without changing typed-option mapping.
3. Run the focused CLI regression and affected package typecheck, then inspect
   the scoped diff, privacy boundary, and Frog status.
4. Close this plan with `scripts/finish-task`, push the exact Draft PR head,
   and refresh the PR body. Do not launch ReviewGPT.

## Constraints

- Do not echo submitted qualifier keys or values.
- Do not change the canonical scheduled-log schema or prior slug-boundary
  behavior.
- Do not add a new projector, repair channel, dependency, or state owner.

## Verification

- The tightened regression first failed with the submitted identifier-shaped
  qualifier key present in the full CLI envelope path, proving the accepted
  leak at the owner boundary.
- The final focused scheduled-log CLI file passes all 14 tests, including
  typed-option recovery, import-json non-disclosure, complete vault and audit
  no-write snapshots, and the existing 160/161 slug boundary.
- The CLI package typecheck passes.
- CLI package-shape verification passes after the canonical hosted-runner build
  prepares its workspace dependency closure.
- Hosted-runner assembly and every parity probe pass. The Vault CLI bundle is
  9,476,650 / 9,479,687 bytes; the complete runner remains
  11,278,814 / 11,393,617 bytes.
- Diff whitespace, privacy, credential, unsafe-cast, and raw source-bundle
  checks pass.
- Frog entry `20260818002151-cli-test-commits` already covers the unprepared
  standalone CLI build prerequisite; no duplicate entry was added.
Completed: 2026-08-24

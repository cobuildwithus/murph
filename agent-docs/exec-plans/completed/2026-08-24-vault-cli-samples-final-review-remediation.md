# Vault CLI Samples Final Review Remediation

## Goal

Remove every submitted or inferred CSV header cell from model-facing sample import repair metadata. Keep the existing atomic import behavior and the clarified `samples batch show` list-to-show wording.

## Product UX Patch

- Outcome: CSV inference failures return fixed, truthful guidance that names the relevant recovery flags without echoing CSV values.
- Reach: `samples import-csv`, `samples csv profile`, and `samples csv import` share the corrected importer contract.
- Proof: focused importer and CLI tests cover headerless, preamble, long, wide, custom, and private header inputs and assert final JSON contains none of those cells.

## Scope

This is the accepted final-review remediation on local commit `903b8d9e`. Delete the conditional trust, schema, and budget machinery for CSV header repair context; do not change PR metadata, push, or run ReviewGPT.

## Tasks

1. Replace conditional CSV repair metadata with fixed value-free expected text and hints naming real CLI flags.
2. Add focused importer and CLI regression coverage for sensitive and malformed header shapes across the changed command leaves.
3. Preserve the existing batch-show help assertion and atomic invalid-row behavior.
4. Run focused tests, package typechecks, diff/privacy checks, and create one scoped local commit.

## Verification

- Importer focused Vitest files.
- CLI focused sample recovery and batch-show Vitest cases.
- Importers and CLI package typechecks.
- `git diff --check` and a secret/identifier diff scan.

## Completion

- Archive this plan with `scripts/finish-task`.
- Report the local commit, evidence, and LOC breakdown to the parent agent.
Status: completed
Updated: 2026-08-24
Completed: 2026-08-24

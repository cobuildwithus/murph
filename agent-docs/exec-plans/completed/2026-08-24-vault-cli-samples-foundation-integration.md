# Vault CLI Samples Foundation Integration

## Goal

Integrate finalized repair foundation `b9cc5661` into PR #2206 and port every sample repair producer to the foundation-owned `context.issues` projection without retaining or recreating legacy repair-field APIs.

## Product UX Patch

- Outcome: model callers receive bounded, structured sample recovery issues through the single foundation contract.
- Affected people: callers recovering from malformed CSV imports, sample batch lookup mistakes, and provider-event validation failures.
- Invariants: CSV headers and cells never echo; array indices remain in issue paths; skip-reason counts remain useful; mixed arrays remain strictly rejected; list-returned batch ids remain valid inputs to show.
- Walkthrough proof: focused importer, usecase, and final CLI JSON tests replay malformed/private CSV data, indexed provider issues, mixed-array rejection, and batch list/show roundtrip.

## Scope

1. Merge the exact finalized foundation commit into the existing PR branch.
2. Delete stale `VaultCliRepairFieldInput` usage and project sample recovery solely through bounded `context.issues` entries.
3. Preserve existing privacy, validation, atomicity, and list/show behavior.
4. Do not widen arbitrary context serialization or restore removed repair APIs.
5. Keep PR #2206 Draft during implementation; do not merge the PR.

## Verification

- Focused importer, CLI sample, and affected usecase tests.
- Affected package typechecks and package/bundle parity proof.
- Canonical runner-bundle assembly.
- `git diff --check`, privacy scan, exact-head merge-tree proof, and required CI status.

## Completion

- Archive with `scripts/finish-task` after the integrated implementation is stable.
- Push the final candidate, refresh the PR body, and mark PR #2206 Ready only after local proof and parent review.
- Do not launch ReviewGPT in this turn; leave the exact pushed head available for the later finalized-foundation review.
Status: completed
Updated: 2026-08-24
Completed: 2026-08-24

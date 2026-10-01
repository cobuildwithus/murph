# Vault CLI Error-Recovery Audit

Status: completed
Updated: 2026-08-23

## Goal

Audit every registered Vault CLI command family for failures that leave the
calling model with a generic, lossy, or non-actionable error, then publish one
evidence-backed Markdown report that prioritizes the smallest improvements.

## Constraints

- Keep the audit read-only outside the report and this execution plan.
- Treat command input, vault contents, provider data, and local paths as private.
- Recommend model-facing repair feedback separately from durable logging.
- Preserve redacted, value-free operational diagnostics.
- Report only findings proven through the command implementation, shared error
  bridge, tests, or a synthetic focused reproduction.

## Plan

1. Inventory the generated Vault CLI command surface and shared error pipeline.
2. Fan command families across independent read-only reviewers with exact scopes.
3. Verify every candidate finding against its full caller-to-renderer path and
   eliminate duplicates or downstream-mitigated cases.
4. Write a prioritized report with command coverage, evidence, recommended
   repair shape, privacy constraints, and clear no-change areas.
5. Read back the report, check references and privacy, then create a scoped
   documentation commit.

## Verification

- Reconciled 340 generated leaves across 61 roots; the generated Incur map and
  config schema agree, while the hand-authored descriptor covers 236 leaves.
- Verified the shared detail-loss, raw-path, and pre-serve format failures with
  focused synthetic reproductions.
- Ran two selected CLI regression tests across two files; both passed, with 11
  unrelated tests skipped by the focus filter.
- Read back the complete report, checked every referenced repository file,
  passed `git diff --check`, and found no personal paths or identifiers in the
  plan, report, or index diff.
Completed: 2026-08-23

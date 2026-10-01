# Restore complete review context for Frog backlog fixes

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

Resolve Frog #3255 and the surviving archive omission behind #2390. Reconcile
already-landed and duplicate Frog reports separately through GitHub issues.

## Scope and invariants

The existing guarded archive manifest owns inclusion. Add only the tracked
native CI controller policy, PR evidence template, and assistant verification
skill. Preserve all private-file and generated-artifact exclusions. No runtime,
provider calls, dependency changes, or new persisted state are involved.

## Cause and design

CI scanning starts at `.github/workflows` and ordinary source scanning omits
`.agents`. These unchanged required inputs therefore disappear from review
archives. Reuse the exact always-path list rather than widen directory scans.

## Tasks

1. Add regression assertions for actual ZIP entries and byte-identical content.
2. Extend the existing manifest and document its current contract.
3. Run the archive test, CLI typecheck, shell syntax, and complexity checks.
4. Review the scoped diff, close this plan, open the draft PR, admit CI, and
   merge after required checks. Low-risk internal tooling needs no final
   ReviewGPT under the completion workflow.

## Verification

- The new archive regression failed before the manifest correction because the
  native controller policy was absent.
- The focused real archive regression passes after the correction, including
  byte-identical content for all three inputs in both archive modes.
- CLI package typecheck, shell syntax, and `pnpm complexity:diff` pass. The
  complexity guard reports no authored JS/TS source changes.
- Parent diff review confirms three explicit public tracked paths with no
  widened scans or changed exclusions. No final ReviewGPT is required for
  this low-risk internal tooling correction.
- Required exact-head CI and merge remain delivery gates tracked in the PR.
  Internal-only change; no changelog or Product UX journey applies.
Completed: 2026-09-11

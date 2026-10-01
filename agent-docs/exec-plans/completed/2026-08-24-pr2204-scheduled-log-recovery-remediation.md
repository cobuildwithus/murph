# PR 2204 Scheduled-Log Recovery Remediation

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

Resolve the accepted recovery-contract findings for the vault CLI activity
slice: make model-facing repair paths match real command inputs, stop truthfully
on corrupt stored scheduled-log registries, keep exercise-catalog fallback
authority-neutral, and remove stored-validation drift between core and query.

## Evidence

- Preliminary review found terminal stored-registry guidance represented as a
  repairable field error, exercise-catalog recovery requiring unavailable
  installation authority, input paths that did not exist on the invoking
  command, and incomplete action-family rejection coverage.
- Final review found query accepted stored scheduled-log frontmatter that the
  canonical contract rejects, while core reported some stored canonical
  failures as newly submitted input errors.
- Both owning packages already depend directly on `@murphai/contracts`, which
  owns `scheduledLogFrontmatterSchema`; no new package dependency is required.

## Tasks

1. Reuse the canonical scheduled-log frontmatter schema in core and query for
   stored registry records.
2. Classify stored YAML, shape, and canonical failures as terminal
   `invalid_registry`, while preserving field repair for submitted save/import
   payloads.
3. Align all accepted CLI recovery fields and exercise fallback guidance with
   actions available to the model.
4. Cover every maintained action-specific option, valid shared fields, stored
   corruption across command families, and submitted-input repair with exact
   no-write/non-echo assertions.
5. Run focused package tests and affected typechecks, inspect the final diff,
   and archive this plan through `scripts/finish-task`.

## Constraints

- Add no state owner, service, compatibility layer, or dependency.
- Preserve filesystem and unexpected I/O failures instead of misclassifying
  them as registry corruption.
- Do not expose stored values or filesystem paths in recovery envelopes.
- Do not push, alter PR metadata, or run another review.

## Verification

- Core scheduled-log tests pass: 1 file, 7 tests.
- Query scheduled-log tests pass: 1 file, 3 tests.
- CLI scheduled-log and exercise recovery tests pass: 2 files, 16 tests,
  including 34 maintained action-family incompatibility cases and 21 stored
  corruption command/variant combinations.
- Core, query, and CLI package typechecks pass.
- `git diff --check`, privacy scan, and scoped diff review pass.

## Progress

- Core and query now parse stored scheduled-log frontmatter through the same
  canonical contracts schema and retain their existing stable tag
  normalization after validation.
- Stored YAML, shape, id, tag, schedule, and action failures become one
  non-echoing stored-registry classification; filesystem errors retain their
  original classification.
- Typed save and JSON import keep distinct, real repair paths, while corrupt
  stored registries return no editable field and explicitly prohibit retry,
  registry editing, and scheduled-log writes.
- Exercise catalog failures now permit only a conservative description or a
  stop, without requiring package installation authority.
- Table-driven coverage is coupled to the maintained action-option registry,
  and shared fields are saved successfully for every action kind.
Completed: 2026-08-24

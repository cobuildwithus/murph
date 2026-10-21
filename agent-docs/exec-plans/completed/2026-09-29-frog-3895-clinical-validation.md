# Validate clinical raw evidence through its manifest contract

Status: completed
Created: 2026-09-29
Updated: 2026-09-29

## Goal and evidence

Frog autofix issue: #3895. The generic validator applies the flat raw-import schema
and immediate-parent manifest rule to valid nested clinical FHIR snapshots.
Route those snapshots through the existing clinical schema and immutable hashes.

## Scope and architecture

Core remains the read-only whole-vault validator. Reuse the public clinical-records
contract through an acyclic workspace dependency; clinical-records depends only
on contracts. No importer logic is copied into Core, and no canonical files are
rewritten. Keep generic import validation unchanged. Validate page and attachment
membership, manifest identity, existing bytes and hashes, and batch predecessor
hashes. The importer retains clinical interpretation and pagination ownership.

## Product UX and risks

A valid imported snapshot should pass the public vault validator. Corrupt, missing,
unbound, or mismatched evidence must still fail. Synthetic filesystem regression
cases exercise both outcomes; no personal records or production access is needed.
This runtime and dependency change requires human merge authorization.

## Tasks and proof

1. Reproduce the valid clinical snapshot rejection with a focused failing test.
2. Add clinical manifest routing and preserve fail-closed evidence validation.
3. Run focused Core/importer proof, Core typecheck, complexity and privacy checks.
4. Inspect the final diff, open a draft PR, complete ReviewGPT and exact-head CI.

## Progress

- Isolated worktree created from verified origin/main.
- Source inspection establishes both incorrect generic assumptions.

- RED: the valid clinical snapshot failed with generic schema and nested-manifest errors.
- GREEN: 13 clinical evidence regressions; 61 existing generic raw validation cases;
  composed clinical planner → canonical import → valid vault → tamper rejection.
- Core and importer typechecks, workspace boundaries, docs drift and complexity pass.
  Existing generic-validator and inbox-reference hotspots are unchanged; clinical
  grouping stays with the clinical validation owner and is linear in file count.
- Candidate privacy and parent review passed. Synthetic evidence only.
- PR exact-head CI and ReviewGPT remain completion gates; human merge required.
Completed: 2026-09-29

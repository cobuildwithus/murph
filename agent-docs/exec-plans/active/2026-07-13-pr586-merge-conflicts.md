# PR 586 Merge Conflict Resolution

Status: active
Created: 2026-07-13
Updated: 2026-07-13

## Goal

- Reconcile PR 586 with current `main`, preserve both the browser-vault speed
  work and compatible base-branch behavior, and restore a conflict-free PR
  head.

## Success criteria

- The PR branch contains a normal merge from current `origin/main`.
- Every manual conflict is resolved from code-path evidence rather than a
  blanket side choice.
- Focused conflict-path verification and the truthful diff-aware app lane pass.
- The resolved merge is committed, pushed, and GitHub reports no merge conflict.

## Scope

- In scope: the three files reported by the merge preview, any directly required
  tests, task coordination artifacts, and the merge commit itself.
- Out of scope: unrelated cleanup or changes to the PR's intended behavior.

## Constraints

- Preserve browser-vault privacy, auth/session invalidation, billing-state
  ownership, and hosted-local E2E fidelity.
- Preserve unrelated working-tree and coordination-ledger edits.
- Do not include secrets, direct identifiers, or local paths in committed text.

## Tasks

1. Inspect the base, PR, and `main` versions of each conflicting hunk.
2. Merge current `origin/main` and resolve each conflict at the owning boundary.
3. Run focused tests, truthful diff-aware app verification, required audits, and
   parent final review.
4. Close the plan in the merge commit, push the PR branch, start ReviewGPT with
   CI, and confirm GitHub mergeability.

## Verification

- Pending.


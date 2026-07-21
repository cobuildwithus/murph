# Crabbox Git-State Remediation

## Goal

Implement the PR #812 round-two retrospective decision: authorize Blacksmith delegation from one complete Git-status boundary so intent-to-add and every other non-authorized state fail before working-tree bytes leave the host.

## Constraints

- Preserve the immutable first-reviewed head `3c00660fde9f039ec94d68ffb2fb5ca10e483f3c` and round-two previous head `83d04a15b1add15bfe256305c05e2138c74f3c86`.
- Allow modified tracked files, tracked renames, tracked deletions, ignored files, and fully staged additions.
- Refuse untracked, intent-to-add, staged-plus-modified or staged-plus-deleted additions, unmerged, and unsupported Git states before Crabbox starts.
- Use one `git status --porcelain=v1 -z --untracked-files=all` admission source, followed by the existing cached sensitive-path policy.
- Replace the incomplete split; do not add another filename classifier, state owner, compatibility mechanism, or reconciliation path.

## Plan

1. Replace the split untracked/cached admission inference with strict porcelain-status parsing and fail-closed state classification.
2. Add production-faithful temporary-repository and black-box no-delegation proof across the retrospective state matrix.
3. Update the verification contract and PR non-obvious-surface disclosure, then run focused tests, canonical scoped verification, docs drift, and coverage-write audit.
4. Commit, push, run ReviewGPT correction round 3 with the recorded retrospective decision, and close exact-head CI plus mergeability.

## State

Complete. The dispatcher now derives sync authorization from one porcelain-v1
status boundary, refuses every non-authorized state before delegation, and keeps
the cached sensitive-path check as the final repository-path policy. Focused
verification passed 29 tests, canonical `test:diff` passed 27 files / 394 tests,
docs drift and syntax checks passed, and the required coverage-write audit closed
without unresolved findings.
Status: completed
Updated: 2026-07-20
Completed: 2026-07-20

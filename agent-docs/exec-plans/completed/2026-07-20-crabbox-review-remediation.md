# Crabbox Review Remediation

## Goal

Resolve the two accepted ReviewGPT round-one findings on PR #812 without changing the dispatcher contract: give Assistant Engine coverage the repository-owned heap already used by CI, and prevent arbitrary untracked files from entering Blacksmith's delegated Git sync set.

## Constraints

- Keep `scripts/workspace-verify.sh` as the verification-semantics owner.
- Reject inherited developer `NODE_OPTIONS`; add only the exact 6144 MiB Assistant Engine coverage setting already proven in CI.
- Reject every untracked, non-ignored path before Crabbox starts; permit modified tracked files and intentionally staged new source subject to the existing sensitive-path policy.
- Do not add a broader credential classifier, dependency, persisted state, or second sync implementation.
- Preserve the exact Round 1 head `3c00660fde9f039ec94d68ffb2fb5ca10e483f3c` for ReviewGPT correction evidence.

## Plan

1. Add a package-owner heap override and a focused shell harness proving only Assistant Engine receives it.
2. Split the Blacksmith preflight into an untracked fail-closed check and a cached-path sensitive-name check, with executable and temporary-repository regression proof.
3. Run focused tests, syntax, canonical scoped verification, Assistant Engine coverage under the synthetic boundary, docs drift, and coverage-write audit.
4. Commit and push the remediation, update the PR intent/evidence without changing the immutable first-head line, then run ReviewGPT correction round 2 alongside exact-head CI.

## State

Implementation and local verification complete. The focused remediation suite passes 28 tests, the coverage-write audit has no unresolved findings, docs drift passes, canonical scoped `test:diff` passes 27 files and 393 tests, and Assistant Engine coverage passes 169 files and 2,526 tests under the stripped synthetic environment with the repository-owned 6144 MiB heap. Ready for the scoped remediation commit, pushed-head CI, and ReviewGPT correction round 2.
Status: completed
Updated: 2026-07-20
Completed: 2026-07-20

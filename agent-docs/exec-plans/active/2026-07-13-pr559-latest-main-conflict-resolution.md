# PR 559 latest-main conflict resolution

Status: active
Created: 2026-07-13
Updated: 2026-07-13

## Goal

- Bring PR #559 onto the current `main` without weakening its audited WHOOP
  spot-HRV privacy, replay, canonical ownership, or RMSSD/SDNN separation
  guarantees, then prove the resulting exact head is merge-ready.

## Success criteria

- Current `main` merges normally and the two core conflicts preserve both
  main's storage-idempotency ownership model and PR #559's immutable admission
  identity/timezone replay contract.
- Focused core and device-sync integration tests, the truthful affected-owner
  verification lane, scenario integrity, and required type proof pass.
- The scoped merge-resolution commit is pushed only after a remote-head guard.
- CI is green, ReviewGPT certifies the final PR-specific head when required,
  and GitHub reports no base conflict.

## Scope

- In scope: PR #559, current-main merge resolution, directly affected core
  tests, required verification/audits, PR contract refresh, CI, and ReviewGPT.
- Out of scope: the iOS implementation, new protocol behavior, deployment,
  real-device execution, unrelated branches, and unrelated working trees.

## Constraints

- Technical constraints: raw BLE packets and RR intervals remain on-device;
  capture receipt identity and admission identity remain distinct; canonical
  import preserves the first timezone placement for an exact admission while
  rejecting every non-temporal immutable mismatch; Apple Health stays SDNN.
- Product/process constraints: no subagents; preserve ordinary merge history;
  do not rerun ReviewGPT for base-only movement, but do rerun if manual conflict
  resolution changes the PR-specific patch; use ReviewGPT 0.5.106 Pro/current
  with a 120-minute wait.

## Risks and mitigations

1. Risk: choosing one side of the core conflict drops either the new storage
   ownership protections or the audited immutable WHOOP replay behavior.
   Mitigation: resolve from the merged main implementation, retain both sets of
   helpers/branches in their correct ordering, and add/run focused regressions.
2. Risk: a stale remote update is overwritten.
   Mitigation: compare the remote branch OID with the expected pre-push OID and
   stop on mismatch.

## Tasks

1. Reconcile current local/remote/PR state and inspect both conflict parents.
2. Merge current `main` and resolve the core source/test conflicts.
3. Run focused and routed verification plus direct privacy/diff checks.
4. Complete the parent-owned security/privacy, coverage, and final review.
5. Close the plan, commit, guard the remote head, push, and refresh PR intent.
6. Run CI and exact-head ReviewGPT as required; validate every finding and
   finish only when the final head is conflict-free and merge-ready.

## Decisions

- Treat the manual conflict resolution as a PR-specific patch change unless a
  post-resolution range comparison proves it is semantically base-only.
- Keep the physical 60-second capture as a deployment-gate limitation; do not
  fabricate it as merge-readiness evidence for this backend conflict repair.

## Verification

- Focused core device-import tests covering immutable WHOOP timezone replay and
  current-main storage idempotency.
- Focused contracts/importers/device-syncd/assistant-runtime/web/query tests and
  typechecks selected by the resolved diff.
- `pnpm test:diff` for the affected PR owners, `pnpm test:scenario-integrity`,
  `git diff --check`, and privacy/credential/path scans.
- Final GitHub checks, exact-head ReviewGPT when required, and mergeability
  proof against a freshly fetched `main`.

# PR 559 latest-main conflict resolution

Status: completed
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

- Merged the earlier and final current-main heads with ordinary two-parent
  merge commits. The final merge at `2da4491485` includes `67e98e2c3b` and
  resolved the security index, durable-doc index, and Prisma migration
  inventory additively. A parent-tree comparison caught and restored eight
  base-only changelog paths that Git had retained at the older tree; the final
  PR diff has the same intended 75-path scope with no missing or extra path.
- The final merged tree passed 1,264 focused assertions: contracts 7, core 138,
  importers 137, device-syncd 375, assistant-runtime 164, web 305, query 91,
  and health-metrics 47. This includes the manually resolved migration
  inventory and the timezone-only replay after a later user-authored revision.
- A serialized full `pnpm verify:acceptance` pass on the preceding merged head
  completed every workspace typecheck and every package coverage lane. Its only
  failures were four unrelated CLI subprocess timeouts and one unrelated audio
  stop/drain assertion under host contention; all five exact tests then passed
  unchanged in isolation, including the CLI discovery test under its default
  timeout after load subsided.
- Final-tree typechecks passed for contracts, core, importers, device-syncd,
  assistant-runtime, query, health-metrics, and web. Latest-main workspace links
  were refreshed with `pnpm install --frozen-lockfile` before the final
  assistant-runtime proof.
- Direct security/privacy review found no evidence-backed medium-or-higher
  issue. Coverage review added the narrow user-revision timezone replay proof.
  Scope/shape and final diff review found no remaining actionable issue.
- `git diff --check`, conflict-marker inspection, and local path, credential,
  and private-key scans passed before both merge commits. The remaining
  physical 60-second signed-iPhone capture is an explicit deployment gate, not
  fabricated merge-readiness evidence.
Completed: 2026-07-13

# PR 627 Legacy Personal-Home Route Repair

Status: completed
Created: 2026-07-14

## Goal

Keep existing active and paused automations with an audited legacy bare Linq
personal-home route runnable after a home-chat rebind, without restoring the
retired producer flags, runtime maintenance repair, or pending-index machinery.

## Proven failure

- A retained bare Linq route has neither `currentRouteSnapshot` nor
  `threadIsDirect`.
- Current-home rebinding does not rewrite that stored automation route.
- Cron resolution therefore cannot bind it to the current home, and hosted
  delivery rejects its unknown audience rather than completing the occurrence.

## Scope

- Restore the canonical core route repair as an audited atomic write.
- Retain a manual CLI that derives authority only from exact operator-supplied,
  retained direct-Linq input records.
- Cover active/paused eligibility, archived/group/unrelated exclusions,
  rollback, and exact-input validation.
- Record the production inventory/drain removal gate in this durable plan and
  the PR rationale.

## Plan

1. Restore the canonical core owner and focused registry tests.
2. Add the self-contained exact-input CLI and its integration coverage.
3. Preserve the narrow production drain gate in the durable plan and PR body
   without editing a shared deployment guide owned by another active lane.
4. Run focused verification, security/privacy review, coverage review, and the
   repository completion gates allowed by host health.
5. Commit and push the exact scoped patch, then run one fresh exact-head
   ReviewGPT round concurrently with CI.

## Boundaries

- Do not change the live managed-automation, cron execution, device-tag, or
  hosted maintenance integration files owned by the separate remediation lane.
- Do not edit `apps/cloudflare/DEPLOY.md`, which is owned by another active
  ledger lane.
- Do not restore `previousHomeThreadId` production use, producer flags,
  automatic runtime repair, or pending-input prioritization.
- Do not merge the PR in this task.

## Verification

- Static reachability proof confirmed that a bare retained route cannot resolve
  current-home binding and reaches the hosted unverified-audience failure path,
  while current managed-automation reconciliation preserves the stale route.
- `git diff --check` passed after implementation and coverage review.
- The required security/privacy audit found no evidence-backed medium-or-higher
  finding.
- The required coverage-write audit added the self-authored Linq rejection
  regression and found no remaining actionable proof gap.
- Local Vitest, typecheck, and `pnpm test:diff` execution is deferred to
  exact-head CI under the documented host-health exception: sustained host load
  remained more than four times the available CPU count, so local heavy commands
  were not started.
- Exact-head CI and the fresh ReviewGPT round remain pending until the scoped
  commit is pushed.

## Decisions

- The CLI trusts only exact retained input IDs whose stored conversation and
  reply target independently prove a direct Linq route.
- Compatibility removal remains gated on an audited production inventory that
  finds zero eligible active or paused bare Linq routes.
Updated: 2026-07-14
Completed: 2026-07-14

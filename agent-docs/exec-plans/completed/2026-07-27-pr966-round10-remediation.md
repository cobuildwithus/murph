# PR 966 Round 10 Remediation

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Complete preview group-avatar publication by reading the deployment origin
  from the existing per-job trusted platform environment.

## Success criteria

- Publisher response validation receives
  `job.runtime.platformEnv.CF_PUBLIC_BASE_URL`.
- The container supervisor environment is not made a second configuration
  owner.
- A path-level invocation test proves a preview-origin capability succeeds
  when the supervisor environment omits the variable.
- Focused tests, affected typechecks, correction ReviewGPT, and exact-head CI
  pass.

## Scope

- In scope:
  - hosted workspace invocation origin lookup
  - path-level regression proof
  - current PR body and review bookkeeping
- Out of scope:
  - new environment channels
  - capability-format or R2 ownership changes

## Tasks

1. [x] Move private-media delivery-origin lookup to the normalized job runtime.
2. [x] Add a preview-origin invocation regression with no supervisor variable.
3. [x] Run focused verification and close the implementation plan.
4. [x] Push the closed-plan head next so ReviewGPT round 11 and exact-head CI
   can run against the merge candidate.

## Decisions

- Keep `runtime.platformEnv` as the only runner-side owner of
  `CF_PUBLIC_BASE_URL`.
- Do not expose the variable in the process-level container environment.

## Verification

- Passed: hosted workspace invocation, private-media, and runner-env focused
  Vitest (3 files, 65 tests).
- Passed: Cloudflare runner typecheck.
- Passed after the latest base merge: 181 hosted Web tests, 61
  hosted-execution parser tests, 185 Cloudflare private-media/deploy/runner
  tests, 18 assistant-runtime boundary tests, 14 isolated PostgreSQL
  account-deletion/member-lock tests, and the four affected owner typechecks.
- `pnpm test:diff` for the two touched Cloudflare paths passed dependency,
  workspace-boundary, hosted-runtime, Temporal, crypto, and logging guards,
  then could not acquire the non-FIFO shared-host slot from an unrelated
  Cloudflare verifier. The session-owned waiter was cancelled before app
  execution (exit 130); the focused owner proof above is the next-best local
  validation.
- ReviewGPT round 11 and exact-head CI run after this plan is archived and the
  resulting correction head is pushed.
Completed: 2026-07-27

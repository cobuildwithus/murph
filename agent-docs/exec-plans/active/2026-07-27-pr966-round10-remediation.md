# PR 966 Round 10 Remediation

Status: active
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

1. Move private-media delivery-origin lookup to the normalized job runtime.
2. Add a preview-origin invocation regression with no supervisor variable.
3. Run focused verification and close the plan.
4. Push the corrected head, run ReviewGPT round 11, and clear exact-head CI.

## Decisions

- Keep `runtime.platformEnv` as the only runner-side owner of
  `CF_PUBLIC_BASE_URL`.
- Do not expose the variable in the process-level container environment.

## Verification

- Pending.

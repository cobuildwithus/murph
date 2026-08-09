# Preserve runtime checkpoints during deploys

Status: active
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Prevent ordinary production deploys from interrupting an active hosted
  runtime before its dirty shutdown checkpoint can finish.
- Correct the incident diagnosis and remove the unrelated startup-fence change.

## Success criteria

- Production deploys default to the existing gradual container rollout with
  the configured 300-second active grace period.
- Operators can still select an explicit immediate rollout for a documented
  hard cut, with the checkpoint-continuity risk stated clearly.
- The expired selector-scope migration guard no longer rejects gradual
  production rollouts.
- The private deployment workflow and convenience command also default to
  gradual, while continuing to forward an explicit operator selection.
- The prior-version fence retains its established immediate replacement
  behavior and focused regressions.
- Focused deploy tests, Cloudflare typecheck, exact-head review, and PR CI pass.

## Scope

- Cloudflare deploy default and production preflight.
- Private deployment workflow default and convenience command.
- Focused deploy and runtime-fence tests.
- Current hosted deploy and runtime continuity documentation.

## Constraints

- No new state owner, queue, retry loop, or startup delay.
- Do not weaken explicit hard-cut rollout requirements documented for active
  compatibility migrations.
- Preserve the existing 300-second container active-grace configuration.

## Tasks

1. [x] Reconstruct the alert chronology from control and runtime-log evidence.
2. [x] Disprove concurrent execution and identify the interrupted checkpoint.
3. [x] Revert the unrelated startup-fence behavior and false incident record.
4. [x] Restore gradual production rollout as the ordinary deploy default.
5. [ ] Run focused verification, exact-head ReviewGPT, and PR CI.
6. [ ] Update the PR, close this plan, and hand off deployment checks.

## Verification log

- Cloudflare deploy, preflight, and rollout-config tests: 104 passed.
- Focused runtime-fence regressions: 4 passed.
- Cloudflare package typecheck passed.
- Private deployment-workflow regressions: 10 passed.
- Private repository `pnpm verify` passed, including typecheck, 130-test
  coverage suite, and Temporal workflow-bundle build.

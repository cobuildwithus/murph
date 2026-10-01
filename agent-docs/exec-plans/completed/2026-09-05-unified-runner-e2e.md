# Align hosted E2E with unified runner allocation

Status: completed
Created: 2026-09-05
Updated: 2026-09-05

## Goal

Align the hosted-local proof fixtures with the merged unified-fleet contract, preserving delivery, background exclusion, and exact-target recovery assertions.

## Success criteria

- Webhook tests preserve signed ingress, typing no-op, and exactly-once reply assertions without expecting removed shell-prewarm telemetry.
- Foreground tests prove both ready slots survive background work and a foreground fence claims one of those exact slots.
- Stale-invocation test controls retain the existing opaque target and preserve production reservation checks.
- Focused tests and Cloudflare typecheck pass; exact-head CI gates the follow-up merge. The private Linux end-to-end suite remains a separate required gate before the companion merge and production deployment.

## Scope and owners

Only hosted-local test controls and fixtures are intended to change. UserRunner remains the production allocation and fence owner. No production authority, allocation policy, or deployment settings change in this correction.

## Evidence and decisions

Private integration against the merged public runtime exposed obsolete shell-prewarm assertions, a single-slot equality assumption, and a stale-invocation fixture conflicting with an existing target reservation. The isolated GitHub startup HTTP 500 passed on targeted retry. The Environment preemption timeout still requires Linux integration proof; its delivery assertions remain unchanged.

## Completed correction

1. Removed obsolete prewarm trace expectations while preserving signed ingress, inert typing, exactly-once delivery, and bounded waiting for asynchronous reply telemetry.
2. Proved the complete two-slot ready inventory survives background work and foreground allocation selects one of those exact slots, distinct from the background owner.
3. Derived the stale-invocation fixture target from the existing reservation and added both same-version flag variants to the real state-store test harness.
4. Parent-reviewed the complete diff and privacy boundary. This test-only correction is exempt from final ReviewGPT under the completion workflow; it adds no production behavior or new authority.

## Verification

- Passed all 169 tests in `apps/cloudflare/test/user-runner-alarm.test.ts` with the Cloudflare Node Vitest configuration.
- Passed `pnpm --dir apps/cloudflare typecheck`, `pnpm docs:drift`, `pnpm complexity:diff`, and `git diff --check`. Complexity reports no changed-source hotspot above 20.
- Built the full hosted-local runner bundle successfully.
- Attempted `pnpm hosted-local e2e foreground-reply-priority linq-webhook`, then a focused first-process diagnostic. The local container init exits before test execution because the platform does not provide `PR_SET_CHILD_SUBREAPER`; 11 tests were skipped during failed setup. An explicit Docker endpoint fixed diagnostic connectivity but did not remove the init limitation.
- Next proof owner: required public exact-head CI, then the existing private Linux integration workflow against merged public main. No end-to-end success or production deployment is claimed by this record.

## Parent rollout handoff

The public runtime PR is merged and its Web deployment succeeded. The private companion and production rollout remain gated on the updated Linux integration suite, including the unchanged Environment preemption assertion. Preserve total capacity and follow the documented off-first migration after all gates pass.
Completed: 2026-09-05

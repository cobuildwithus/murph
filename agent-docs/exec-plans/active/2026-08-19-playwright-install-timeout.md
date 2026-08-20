# Playwright Install Timeout Recovery

## Goal

Make browser-driving CI recover from one stalled operating-system dependency
install without allowing an old installer process tree to overlap the retry or
letting the wrapper consume the workflow step's entire timeout budget.

## Evidence

- The failing Web Viewport Overflow run never reached its browser test. Its
  Playwright dependency install stopped producing output inside `apt-get` and
  was cancelled by the job's 20-minute ceiling.
- The same install completed in 45 seconds on the next workflow attempt, which
  identifies a transient installation stall rather than a viewport regression.
- The preliminary specialist review found that the first retry wrapper could
  leave descendants alive and had no headroom between its internal worst case
  and the GitHub Actions step timeout.

## Constraints

- One wrapper owns each exact `pnpm` process group from launch through cleanup.
- No retry may start until the prior group is proven absent.
- The wrapper must preserve a real install failure and report a timeout with a
  distinct status after the final bounded attempt.
- The declared worst case must remain at least two minutes below every calling
  workflow step timeout.
- Keep the change internal to CI; add no runtime dependency or member-facing
  behavior.

## Plan

1. Correct the wrapper's process-group signaling and bounded TERM/KILL cleanup.
2. Add focused tests for success, timeout recovery, terminal timeout, ordinary
   failure, descendant cleanup, retry count, and timeout-budget headroom.
3. Keep the three Chromium-install workflows on the shared wrapper and document
   the verification contract.
4. Run focused proof, complete the final ReviewGPT and exact-head CI gates,
   merge the PR, and retire the task worktree.

## Verification

- `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage
  scripts/install-playwright-chromium.test.ts
  scripts/check-hosted-stripe-billing-ci.test.ts
  scripts/frog-workflow-guards.test.ts scripts/verification-dispatch.test.ts`
  passes 57 tests.
- `bash -n scripts/install-playwright-chromium.sh`, `shellcheck`, and
  `git diff --check` pass.
- Pending final ReviewGPT PASS, exact-head required CI, and current-base
  merge-tree proof.

## State

Status: active
Updated: 2026-08-19

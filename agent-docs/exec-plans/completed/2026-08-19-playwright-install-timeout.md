# Playwright Install Timeout Recovery

## Goal

Make browser-driving CI recover from one stalled APT mirror acquisition by
placing the retry and inactivity bounds at APT's native ownership boundary,
without restarting or supervising Playwright's privileged process tree.

## Evidence

- The failing Web Viewport Overflow run never reached its browser test. Its
  Playwright dependency install stopped producing output inside `apt-get` and
  was cancelled by the job's 20-minute ceiling.
- The same install completed in 45 seconds on the next workflow attempt, which
  identifies a transient installation stall rather than a viewport regression.
- The preliminary specialist review found that the first retry wrapper could
  leave descendants alive and had no headroom between its internal worst case
  and the GitHub Actions step timeout.
- Final ReviewGPT round 1 found that even a process-group-aware wrapper cannot
  prove ownership after Playwright crosses the `sudo` boundary, while APT
  already owns per-file retries and HTTP/HTTPS inactivity timeouts.

## Constraints

- Use APT's existing configuration surface for the demonstrated mirror retry;
  do not add another process or retry owner.
- Verify the ephemeral runner loaded the intended policy before Playwright
  starts.
- Invoke Playwright exactly once and preserve its final status.
- Keep every caller's existing 14-minute step ceiling as the final bound on the
  one-shot Playwright install.
- Keep the change internal to CI; add no runtime dependency or member-facing
  behavior.

## Plan

1. Configure one APT acquisition retry plus bounded HTTP/HTTPS inactivity
   timeouts on the ephemeral Ubuntu runner.
2. Verify the loaded policy, then execute the existing Playwright install once.
3. Add focused tests for policy shape/loading, one-shot status propagation,
   caller inventory, Ubuntu ownership, and the overall timeout ceiling.
4. Keep the three Chromium-install workflows on the shared wrapper and document
   the verification contract.
5. Run focused proof, complete the final ReviewGPT and exact-head CI gates,
   merge the PR, and retire the task worktree.

## Verification

- `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage
  scripts/install-playwright-chromium.test.ts
  scripts/check-hosted-stripe-billing-ci.test.ts
  scripts/frog-workflow-guards.test.ts scripts/verification-dispatch.test.ts`
  passes 54 tests.
- `bash -n scripts/install-playwright-chromium.sh`, `shellcheck`,
  `git diff --check`, and the added-line privacy scan pass.
- Final ReviewGPT round 2 passed with no findings and confirmed the accepted
  process-ownership finding is resolved by the APT-native correction.
- Exact-head required CI passed, including the Ubuntu browser workflow that
  executes the corrected install path and the full release-check aggregator.
- The reviewed candidate composes cleanly with current `main` by merge-tree
  proof.

## State

Status: completed
Updated: 2026-08-20
Completed: 2026-08-19
Completed: 2026-08-20

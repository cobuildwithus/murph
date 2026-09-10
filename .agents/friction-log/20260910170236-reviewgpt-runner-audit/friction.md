---
title: 'ReviewGPT runner audit expects a retired browser lane'
severity: 'minor'
---

## Expected Behavior

The ReviewGPT runner audit should accept the current browser-lane configuration so unrelated review-tool changes can complete focused verification.

## Current Behavior

The `exposes only the package-backed review-gpt runner` case in `packages/cli/test/release-script-coverage-audit.test.ts` still expects six browser lanes. The original local parent commit `30e0313104` changed `scripts/review-gpt.config.sh` to five without updating that assertion. Both values predate the review-duration change, so the audit fails on that local lane inventory mismatch.

## Possible Solution

Reconcile the lane-inventory assertion with the canonical configuration and preserve focused executable lane-selection coverage.

## Minimal Reproducible Example

Run `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/release-script-coverage-audit.test.ts -t 'exposes only the package-backed review-gpt runner'` on a checkout containing the local lane-removal commit `30e0313104`.

## Context

Encountered while lowering the ReviewGPT marked-response minimum. The wrapper-precedence and duration-boundary checks pass independently; the stale inventory assertion prevents the broader runner audit from passing.

## Push reconciliation

The review-duration change was isolated onto the latest remote `main`, which still has the matching six-lane configuration. The unrelated local lane-removal commit is excluded from this push. This report records the original local mismatch, not a failure in the current remote configuration.

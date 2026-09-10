---
title: 'ReviewGPT runner audit expects a retired browser lane'
severity: 'minor'
---

## Expected Behavior

The ReviewGPT runner audit should accept the current browser-lane configuration so unrelated review-tool changes can complete focused verification.

## Current Behavior

The `exposes only the package-backed review-gpt runner` case in `packages/cli/test/release-script-coverage-audit.test.ts` still expects six browser lanes. The committed `scripts/review-gpt.config.sh` contains five. Both values predate the review-duration change, so the audit fails on the existing lane inventory mismatch.

## Possible Solution

Reconcile the lane-inventory assertion with the canonical configuration and preserve focused executable lane-selection coverage.

## Minimal Reproducible Example

Run `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/release-script-coverage-audit.test.ts -t 'exposes only the package-backed review-gpt runner'` against the existing configuration.

## Context

Encountered while lowering the ReviewGPT marked-response minimum. The wrapper-precedence and duration-boundary checks pass independently; the stale inventory assertion prevents the broader runner audit from passing.

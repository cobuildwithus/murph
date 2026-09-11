---
title: 'Foreground runtime wake checkpoint test depends on an extra mailbox fetch'
severity: 'minor'
---

## Expected Behavior

The foreground runtime wake checkpoint test should deterministically prove that import finishes before the idle checkpoint.

## Current Behavior

During `pnpm verify:acceptance`, the test `foreground runtime wake import waits until idle before checkpointing` in `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint-restore.test.ts` failed because its exact event list expected a fourth mailbox fetch. The observed sequence still imported the item before the idle snapshot and checkpoint. The same unchanged test passed when run alone. The ReviewGPT duration change does not modify this package.

## Possible Solution

Inspect synchronization between the synthetic assistant phase, background import, and final mailbox fetch. Assert the checkpoint invariant without depending on an incidental poll count, or explicitly synchronize the fourth fetch if it is part of the intended contract.

## Minimal Reproducible Example

Run `pnpm verify:acceptance` with the current synthetic fixtures. The failure is intermittent. To isolate the case, run `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-entrypoint-restore.test.ts -t 'foreground runtime wake import waits until idle before checkpointing'`.

## Context

This unrelated failure interrupted the direct-push acceptance run for a ReviewGPT timing change. The failing test passed on an isolated rerun; the full affected package coverage suite also passed on rerun: 125 test files, 2,987 tests, and all configured coverage thresholds. No runtime code or tests were changed.

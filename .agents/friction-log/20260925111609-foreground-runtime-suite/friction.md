---
title: 'Foreground runtime suite misses projection and vault-share effects on unchanged source'
severity: 'minor'
issue: 'cobuildwithus/murph#3893'
---

## Expected Behavior

The foreground runtime entrypoint suite should pass independently and observe its expected projection and vault-share delivery effects.

## Current Behavior

Five of twenty tests fail on the unchanged task baseline. Three time out waiting for effects; two fail assertions because projection kinds or a vault-share delivery event are absent. The same five failures occur with the unrelated typing-order change applied. This blocks a clean broader regression result even though the focused typing and canonical checkpoint checks pass.

## Minimal Reproducible Example

Run `pnpm build:test-runtime:prepared`, then `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint-foreground-input.test.ts --no-coverage`.

Affected cases cover joining an aborted projection, continuing after a definitive scope failure, checkpointed vault-share under device-sync pressure, failed wake classification, and shutdown during deferred device-sync work.

## Context

Observed during synthetic local regression verification. Repeated with the changed production files restored to the task baseline, reproducing all five failures. The underlying fixture or runtime cause remains unestablished; investigate separately from typing order.

## Resolution

The prepared test-runtime build now includes the assistant-runtime package and
checks the published capture-worker entrypoint. The matching clean target also
removes its generated output. Previously the build could succeed without that
worker, so real vault-share capture failed before the expected effects. Focused
entrypoint tests retain their real worker and existing outcome assertions.

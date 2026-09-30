---
title: 'System-mailbox entrypoint tests fail on a clean base checkout'
severity: 'minor'
issue: 'cobuildwithus/murph#3900'
---

## Expected Behavior

Focused system-mailbox entrypoint tests pass after the documented dependency setup, or identify any missing build prerequisite directly.

## Current Behavior

After a frozen offline dependency install, the model-free daily-metric case and five dirty-ack follow-up cases fail on the unchanged base as well as the candidate. The dirty-ack cases report a projection failure and observe zero acknowledgements where one is expected. The underlying cause has not been established.

## Possible Solution

Make the focused proof establish its required projection-worker build artifacts, or expose the underlying setup failure before asserting mailbox acknowledgements.

## Minimal Reproducible Example

Run `pnpm install --frozen-lockfile --offline`, then `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts -t 'system mailbox mode drains model-free|system mailbox mode preserves successful dirty-ack' --no-coverage` in a fresh checkout. Six cases fail; three pass.

## Context

The identical failures were reproduced with both edited production source files restored to the base revision. They obscure verification of an unrelated empty-selection optimization.

## Resolution

The prepared test-runtime build now includes the assistant-runtime package and
checks the published capture-worker entrypoint. The matching clean target also
removes its generated output. Previously the build could succeed without that
worker, so real vault-share capture failed before the expected effects. Focused
entrypoint tests retain their real worker and existing outcome assertions.

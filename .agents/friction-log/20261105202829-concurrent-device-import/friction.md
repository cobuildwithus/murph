---
title: 'Concurrent device-import fixture sometimes retains a scheduled maintenance item'
severity: 'minor'
---

## Expected Behavior

The concurrent device-import proof should deterministically verify foreground delivery, cancellation, receipt upload, and completion without failing on unrelated scheduled maintenance.

## Current Behavior

One single-worker `pnpm test:diff` run failed the long-finalization case in `packages/assistant-runtime/test/hosted-runtime-concurrent-device-import.integration.test.ts`. Its final empty-pending-queue assertion observed a pending dense raw-retention maintenance item. The preceding delivery, import-attempt, cancellation, receipt, and dirty-ack assertions passed.

An unchanged isolated rerun of that case passed. A subsequent unchanged run of the complete file passed all 12 tests. This records an intermittent observation, not a deterministic reproduction or a proven production defect.

## Possible Solution

Synchronize the fixture's advanced fake clock with maintenance scheduling, or explicitly account for independent maintenance work when asserting that the tested import has completed. Preserve the foreground-delivery and import-completion assertions.

## Minimal Reproducible Example

Run `pnpm test:diff packages/assistant-runtime/src/hosted-runtime/system-mailbox-state.ts` in the local single-worker lane. The failure was observed during broader package fanout. For the focused diagnostic, run `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-concurrent-device-import.integration.test.ts --no-coverage`.

## Context

The broad verification stopped after assistant-engine passed and assistant-runtime reported one failure among 4,093 tests. The targeted case and full file passed afterward. The device-import test and maintenance implementation were unchanged by the sponsorship-personalization removal being verified.

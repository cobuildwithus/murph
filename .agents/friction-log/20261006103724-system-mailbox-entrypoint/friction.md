---
title: 'System mailbox entrypoint fixtures fail projection and dirty acknowledgement on unchanged main'
severity: 'minor'
issue: 'cobuildwithus/murph#4058'
---

## Expected Behavior

The focused system mailbox entrypoint suite should pass on unchanged main before a runtime fix is applied.

## Current Behavior

At base commit 1d8c8762af9e, the suite reports 78 passing tests and six failures. The daily-metric model-free case fails its projection expectation. Five successful dirty-ack follow-up variants observe zero acknowledgements after projection failure. The same six failures occur with a narrow schedule-import change; its independent mailbox and checkpoint tests pass.

## Minimal Reproducible Example

Run `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts --no-coverage` from a frozen-lockfile checkout of that base.

## Context

Baseline verification is required to distinguish existing fixture or dependency failures from a mailbox regression. Keep this repair with the entrypoint fixture owner.

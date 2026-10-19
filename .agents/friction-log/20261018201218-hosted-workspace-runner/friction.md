---
title: 'Hosted workspace runner wake-interrupt test flakes under parallel acceptance load'
severity: 'minor'
---

## Expected Behavior

`runtime wake interrupts an in-flight provider cleanup request after late assistant input import` in `packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts` passes deterministically, including inside `MURPH_VERIFY_EXECUTOR=local pnpm verify:acceptance`.

## Current Behavior

Under the parallel package-coverage stage of local acceptance, the test can observe foreground yield states `[false, false]` instead of `[false, true]` and fail. The same test passes repeatedly when run alone, so the failure depends on scheduling load rather than the change under test.

## Possible Solution

Drive the wake and the second import from an explicit synchronization point instead of relying on timing between the in-flight cleanup request and the runtime wake.

## Minimal Reproducible Example

1. Run `MURPH_VERIFY_EXECUTOR=local pnpm verify:acceptance` on a loaded developer machine.
2. Observe the assertion at the yield-state check fail once.
3. Run `pnpm --dir packages/assistant-runtime exec vitest run --no-coverage test/hosted-runtime-workspace-runner.test.ts -t 'runtime wake interrupts an in-flight provider cleanup request'` five times; all pass.

## Context

Seen during acceptance for an unrelated Codex CLI upgrade; it forces a full acceptance rerun.

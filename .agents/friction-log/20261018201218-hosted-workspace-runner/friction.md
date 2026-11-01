---
title: 'Hosted workspace runner wake-interrupt test failed once in local acceptance'
severity: 'minor'
issue: 'cobuildwithus/murph#4226'
---

## Expected Behavior

`runtime wake interrupts an in-flight provider cleanup request after late assistant input import` in `packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts` passes deterministically, including inside `MURPH_VERIFY_EXECUTOR=local pnpm verify:acceptance`.

## Current Behavior

In one full local acceptance run, during the parallel package-coverage stage, the test observed foreground yield states `[false, false]` instead of `[false, true]` and failed. The same test then passed in five isolated runs, and a later full acceptance run on the same source passed. The root cause is not established: scheduling load is one hypothesis, and an interaction with other concurrently running suites or with the change under test has not been excluded.

## Possible Solution

First reproduce the failure and identify what ordering the test depends on. If it proves timing-dependent, drive the wake and the second import from an explicit synchronization point.

## Minimal Reproducible Example

No reliable reproduction yet. Observed sequence:

1. One `MURPH_VERIFY_EXECUTOR=local pnpm verify:acceptance` run failed this assertion.
2. `pnpm --dir packages/assistant-runtime exec vitest run --no-coverage test/hosted-runtime-workspace-runner.test.ts -t 'runtime wake interrupts an in-flight provider cleanup request'` passed five consecutive times.
3. A subsequent full acceptance run passed.

## Context

Seen once during acceptance for a Codex CLI upgrade that does not touch the hosted workspace runner. A single intermittent failure forces a full acceptance rerun; no production fix is indicated by this observation alone.

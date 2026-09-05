---
title: 'Checkpoint log independence test has a 250 ms wall-clock dependency'
severity: 'minor'
---

## Expected Behavior

The checkpoint bridge regression should prove that a queued log write cannot hold checkpoint completion, with deterministic control over unrelated snapshot work.

## Current Behavior

On an unchanged checkout, the focused bridge suite passed 53 cases but failed the queued-finished-record case at its 250 ms checkpoint-settlement assertion. Running that case alone reproduced the same failure. This prevents a clean local baseline for adjacent checkpoint diagnostics before any production source is edited. The cause has not been localized beyond the existing test's wall-clock assertion; this report does not establish that production logging blocks checkpoint completion.

## Minimal Reproducible Example

Run the existing test on an unchanged checkout:

```sh
pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-invocation-bridge.test.ts -t 'does not wait for the queued finished record before returning a checkpoint'
```

Inspect the test's `vi.waitFor` checkpoint-settlement assertion with `timeout: 250` and its real snapshot setup. Reproduce without changing checkpoint behavior or increasing production deadlines.

## Context

Discovered while establishing the baseline for a separate telemetry-only checkpoint change. Preserve this regression's asynchronous-log independence claim; investigate whether deterministic snapshot preparation or another existing harness seam can remove the incidental runtime dependency. No test or production workaround was applied.

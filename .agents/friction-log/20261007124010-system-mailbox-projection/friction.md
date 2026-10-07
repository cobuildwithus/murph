---
title: 'System mailbox projection regressions fail on unchanged base'
severity: 'minor'
---

## Expected Behavior

The assistant-runtime system-preemption suite should exercise synthetic projection delivery during host abort, foreground admission, and a due assistant cron without missing the projection boundary.

## Current Behavior

Four existing projection cases fail on the unchanged base as well as a diagnostics-only candidate: before-delivery host abort observes no projected kinds, active-delivery host abort does not reach its boundary, and the foreground-overlap and assistant-cron projection cases time out. This prevents a green owner suite while unrelated focused cancellation and receipt tests pass.

## Minimal Reproducible Example

From a checkout of public base 1a9e2fa9436a, install the frozen lockfile, then run:

```sh
pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-workspace-entrypoint-system-preemption.test.ts -t 'exact host abort at|foreground runs alongside system projection|system mailbox retains projection delivery' --no-coverage
```

All four selected cases fail. The full two-file maintenance/system-preemption run has the same four failures. No production data or services are required.

## Context

Reproduced while validating a finite device-maintenance yield label. The candidate changes no projection selection, foreground admission, or checkpoint scheduling. Investigate the synthetic projection prerequisites and current owner contract before changing production behavior or weakening assertions.

---
title: 'Hosted Retell roundtrip E2E combines its TypeScript preload with the tsx loader'
severity: 'minor'
issue: 'cobuildwithus/murph#1652'
---

## Expected Behavior

The documented hosted-local Retell result scenario should start its isolated Web, Cloudflare, and Temporal stack when the external Temporal worker package is selected.

## Current Behavior

The Web child exits before health checks because the scenario's test-only TypeScript preload and the tsx loader are resolved as one combined module specifier. The scenario never reaches its assertions.

## Possible Solution

Give hosted-local a test-control preload mechanism that remains valid across the pnpm, tsx, and Next development child-process boundary, or compile the test preload before startup without adding a second runtime owner.

## Minimal Reproducible Example

From a public Murph worktree with the documented private Temporal worker sibling available:

```sh
MURPH_DEV_TEMPORAL_WORKER_PACKAGE_DIR=../murph-cloud/packages/hosted-orchestrator-temporal \
  pnpm hosted-local e2e retell-call-result-roundtrip --profile e2e:stub --no-bundle
```

The runner bundle and database setup can succeed, but the Web child fails while resolving the fault-injection preload together with the tsx loader.

## Context

This blocks local production-shaped proof for transfer-result delivery and replay. Focused Web tests, lint, and typecheck still run normally; exact-head integration CI remains the next faithful lane.

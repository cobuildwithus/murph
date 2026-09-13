---
title: 'Browser vault overflow test exhausts microtask-only wait in CI'
severity: 'minor'
issue: 'cobuildwithus/murph#3114'
---

## Expected Behavior

The browser-vault overflow experiment regression should await its observable loaded state reliably in both isolated and sharded Web test runs.

## Current Behavior

The Web test shard failed `overflow experiment routes derive demand from the immutable legacy outcome` in `apps/web/test/browser-vault-context.test.tsx` while waiting for its exact experiment probe to load. The same unchanged test passed in isolation on the same PR head. The shared `waitForCondition` helper stops after 20 `act`/microtask turns instead of an elapsed asynchronous completion deadline. Timing sensitivity is suspected; a deterministic cause has not yet been reproduced locally.

## Minimal Reproducible Example

Compare the failed Release Web tests (2/4) job in PR #3104 with `pnpm --dir apps/web test -- browser-vault-context.test.tsx -t 'overflow experiment routes derive demand from the immutable legacy outcome'` on its reviewed head. The test and browser-vault runtime are unchanged in that PR.

## Context

An unrelated runner lifecycle simplification was delayed by this test failure. Preserve the probe and two-request assertions when improving its asynchronous waiting; do not add retries to production behavior.

## Follow-up: experiment deep-link probe

PR #3347 reproduced the same native-decompression timing boundary locally in
`experiment deep links load core and metrics index before exact run-card bucket follow-up`.
The shared helper already uses a real asynchronous deadline, but this probe still
asserted loaded state after four microtask flushes. Reuse that helper for the
observable loaded state, retaining the exact state and two-request assertions.
The correction is isolated to test waiting; production behavior is unchanged.

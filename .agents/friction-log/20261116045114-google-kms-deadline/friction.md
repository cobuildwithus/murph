---
title: 'Google KMS deadline test races real retry timers in the full Web suite'
severity: 'minor'
---

## Expected Behavior

The synthetic retry-backoff deadline test deterministically aborts the aggregate deadline during the first retry delay.

## Current Behavior

The full Web suite failed this test once because a second provider attempt allocated another deadline before the test aborted its controlled signal. The test supplies only two deadline signals and waits for the warning through polling while the retry delay uses real timers. The unchanged file passes all 32 tests when run alone. This blocks an otherwise unrelated Progress diff check; it is not evidence of a Progress regression.

## Possible Solution

Synchronize the test with the first retry warning or control its timers so the deadline is aborted before another attempt can start. Attach rejection handling before yielding to the timers.

## Minimal Reproducible Example

Run `pnpm test:diff apps/web/src/lib/game/progress/health-view.ts` under shared verification load. The intermittent failure is in `apps/web/test/hosted-crypto-gcp-kms.test.ts`, test `logs aggregate deadline expiry during Decrypt retry backoff`. Compare the isolated file with `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-crypto-gcp-kms.test.ts`.

## Context

The failing test and its KMS implementation are unchanged in the Progress fix round. The broad run passed 15,740 tests and failed this one; the isolated KMS run passed without changes. Preserve the failed broad result rather than treating the isolated pass as broad proof.

---
title: 'Environment interrupted-recording test asserts exact wake timestamps under load'
severity: 'minor'
---

## Expected Behavior

`packages/assistant-runtime/test/hosted-runtime-environment-interrupted-recording.integration.test.ts` should pass deterministically inside the diff-aware `pnpm test:diff` package fanout, the same way it passes when the file runs alone.

## Current Behavior

In the "settles checkpointed Environment recording in the foreground replacement: projection-error" case, the branch where provider cleanup wakes the default owner before the recording retry compares the runtime's reported `nextWakeAt` with the provider-cleanup checkpoint's `nextWakeAt` using exact string equality. Under parallel package-test load the two clock reads drifted by tens of milliseconds and the assertion failed. Rerunning the file in isolation passed all nine cases, so a diff that never touches this package fails its local lane and has to be rerun.

## Possible Solution

Assert that the two wake times fall within a small tolerance, or derive both values from one injected clock so the comparison is exact by construction.

## Minimal Reproducible Example

1. Change any file whose reverse-dependent fanout includes `packages/assistant-runtime` (a device-syncd provider file is enough).
2. Run `pnpm test:diff <that file>` on a busy host so several package test lanes overlap.
3. Observe the exact-equality assertion on the provider-cleanup wake branch fail by a sub-second delta, then pass when the file runs alone.

## Context

Hit while landing a device-syncd and hosted-web alert fix. The failure is unrelated to the diff and costs a full seven-minute lane rerun to confirm.

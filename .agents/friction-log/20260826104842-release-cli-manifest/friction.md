---
title: 'Release CLI manifest fixed timeout blocks packaging on slower shared hosts'
severity: 'minor'
issue: 'cobuildwithus/murph#2438'
---

## Expected Behavior

`scripts/pack-publishables.mjs` should complete when `vault-cli --llms-full --format json` is making normal progress on a supported development host.

## Current Behavior

The release surface generator has a fixed 60-second child timeout. On a contended shared host, the same built CLI completed successfully in 72 seconds by itself and exceeded 120 seconds when invoked during packaging, so packaging stopped before the artifact secret guard could run.

## Possible Solution

Provide a bounded test-only timeout override for the release surface generator, while retaining the 60-second production default.

## Minimal Reproducible Example

1. Build the prepared CLI runtime.
2. Run `node scripts/pack-publishables.mjs --out-dir <temporary-directory> --pack-output <temporary-directory>/pack-output.json --clean` on a contended supported host.
3. Observe `ASSISTANT_CLI_COMMAND_TIMEOUT` before packaging reaches artifact verification.

## Context

This blocked local reproduction of a release-artifact guard failure and required a temporary edit to an ignored built artifact solely for diagnosis.

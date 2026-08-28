---
title: 'Assistant CLI manifest generation exceeds fixed startup timeout during runner assembly'
severity: 'minor'
issue: 'cobuildwithus/murph#2464'
---

## Expected Behavior

The production runner bundle should generate the assistant CLI surface contract successfully on a supported local build profile.

## Current Behavior

During runner bundle assembly, the assistant-engine build starts `vault-cli --llms-full --format json` through the workspace source launcher and reproducibly exceeds the fixed 60-second manifest timeout. The bundle exits before hosted-local scenarios can start. Both the default serial build and the documented four-package concurrency profile reproduce the timeout.

## Possible Solution

Measure the source-launcher startup path and either reduce its work or let build-time contract generation use the already-built workspace CLI artifact while preserving the runtime timeout.

## Minimal Reproducible Example

```sh
MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY=4 pnpm --dir apps/cloudflare runner:bundle
```

## Context

This blocks production-like hosted-local verification even when focused package tests and typechecks pass. No provider request occurs before the failure.

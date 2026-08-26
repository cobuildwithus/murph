---
title: 'Hosted-local runner bundle exceeds committed byte budget'
severity: 'minor'
---

## Expected Behavior

`pnpm --dir apps/cloudflare runner:bundle:hosted-local` should prepare the reviewed runner bundle when the candidate changes only hosted-local harness code that is outside the runner bundle import graph.

## Current Behavior

The command reproducibly fails because total output is 11,405,379 bytes against an 11,393,617-byte budget and the static boot closure is 8,678,847 bytes against an 8,667,156-byte budget. This blocks production-shaped hosted-local E2E before Docker or MinIO starts, even though the candidate does not change the reported bundle inputs.

## Possible Solution

Identify the source of the bundle growth and either reduce it or update the owning baseline and budget with the intended measured bundle in a dedicated reviewed change.

## Minimal Reproducible Example

From a dependency-installed checkout with workspace packages built, run:

```sh
pnpm --dir apps/cloudflare runner:bundle:hosted-local
```

The command consistently reaches the entrypoint budget assertion and exits nonzero with both total-output and static-closure violations.

## Context

This prevents the canonical `foreground-reply-priority` hosted-local E2E from reaching its Docker startup boundary during an unrelated hosted-local harness repair.

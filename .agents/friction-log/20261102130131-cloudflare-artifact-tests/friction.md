---
title: 'Cloudflare artifact tests race CLI verification in the same checkout'
severity: 'minor'
---

## Expected Behavior

Independent verification commands should either use isolated generated artifacts or coordinate their writes so a CLI import cannot observe a temporarily deleted workspace distribution.

## Current Behavior

Running the Cloudflare Node suite concurrently with verify:cli can fail the CLI help gate because a health-commons distribution entrypoint is absent while artifact tests rebuild workspace packages. Serializing these checks avoids the overlapping writes.

## Minimal Reproducible Example

In one prepared checkout, run `pnpm --dir apps/cloudflare test:node` and `pnpm verify:cli` concurrently. The deploy-artifact fixtures rebuild package distributions that the CLI gate imports. Depending on scheduling, the CLI gate reports a missing health-commons runtime entrypoint.

## Context

Cross-package deletion verification requires both checks. Their shared artifact writes prevent safe parallel verification and can look like an application regression.

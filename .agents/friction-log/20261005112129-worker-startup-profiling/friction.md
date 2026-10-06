---
title: 'Worker startup profiling requires Docker and an ad hoc config copy'
severity: 'minor'
---

## Expected Behavior

An agent can measure the `murph-hosted` Worker's global-scope startup locally (the cost every fresh isolate pays) with one repository command, without building container images.

## Current Behavior

`npx wrangler check startup` in `apps/cloudflare` fails before profiling because the checked-in Wrangler config declares `containers`, and Wrangler requires the Docker CLI to build their images even in dry-run mode. Profiling only works after copying the config without `containers` and passing `--args="--containers-rollout=none"`. Single profiles also vary by about ±10 ms, so comparisons need alternating baseline/variant runs.

## Possible Solution

Add an `apps/cloudflare` script that renders a container-free profiling config and runs alternating `wrangler check startup` samples against a base ref, reporting median non-idle CPU.

## Minimal Reproducible Example

1. `cd apps/cloudflare`
2. `npx wrangler check startup`
3. Observe: "The Docker CLI is needed to build the configured images before deploying (even in dry-run mode)".

## Context

Found while measuring Worker cold-isolate startup for direct-wake latency. Cloudflare reports production startup of roughly 300–600 ms, so local before/after measurement is the main way to evaluate startup changes before a deploy.

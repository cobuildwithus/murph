---
title: 'Container benchmark example pins a stale runner base'
severity: 'minor'
issue: 'cobuildwithus/murph#3130'
---

## Expected Behavior

The documented synthetic Docker reproduction uses the same pinned runner base as the production image contract, so comparisons exercise the current native runtime.

## Current Behavior

The core benchmark README references an older Codex base than Dockerfile.cloudflare-hosted-runner. Copying that example silently benchmarks a different runtime generation.

## Possible Solution

Keep the reproduction example aligned with the production Dockerfile and record the actual image digest in sizing evidence.

## Minimal Reproducible Example

Compare the image tag in packages/core/bench/README.md with the HOSTED_RUNNER_BASE_IMAGE default in Dockerfile.cloudflare-hosted-runner.

## Context

This discrepancy was found while preparing synthetic CPU and memory sizing comparisons. No production data or credentials are involved.

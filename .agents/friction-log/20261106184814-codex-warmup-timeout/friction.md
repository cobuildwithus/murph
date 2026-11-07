---
title: 'Codex warmup timeout proof assumes child startup within 300 ms'
severity: 'minor'
issue: 'cobuildwithus/murph#4715'
---

## Expected Behavior

The synthetic warmup timeout test should accept a timeout before a child has finished starting, while proving cleanup for any child that did start.

## Current Behavior

The full Cloudflare Node suite can fail the stalled app-server test with a missing synthetic startup record. The fixture writes that record only after Node starts executing, but the warmup owner can time out and stop the child after 300 ms. The complete five-test file passed immediately in isolation. This is a load-sensitive test assumption, not evidence of a retention regression.

## Minimal Reproducible Example

Run `pnpm --dir apps/cloudflare test` under shared-host load. Compare the stalled app-server result with `pnpm --dir apps/cloudflare test:node:workspace apps/cloudflare/test/container-codex-binary-warmup.test.ts`. The test unconditionally reads its startup record after the timed-out outcome.

## Context

The full command exited 1 with this single failure; the isolated file and the separately run container-helper suite exited 0. Retention checks passed. No production input or credentials are needed.

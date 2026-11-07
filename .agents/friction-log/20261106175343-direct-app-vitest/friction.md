---
title: 'Direct app Vitest config ignores the worker-count environment override'
severity: 'minor'
---

## Expected Behavior

A direct full hosted-web Vitest run should honor MURPH_VITEST_MAX_WORKERS=1 so PostgreSQL suites sharing one isolated database run serially.

## Current Behavior

The app config spreads resolveMurphVitestConcurrency, which does not include maxWorkers. The root and app command wrappers own worker counts separately. With --config apps/web/vitest.config.ts, the environment override is ignored and Vitest launches multiple workers. Shared PostgreSQL fixtures then contend on singleton locks and global selections.

## Possible Solution

Document the explicit --maxWorkers=1 flag for direct app-config invocations, or route these invocations through the existing budget owner.

## Minimal Reproducible Example

Set MURPH_VITEST_MAX_WORKERS=1 and run pnpm exec vitest run --config apps/web/vitest.config.ts --project hosted-web against an isolated migrated local test database with PostgreSQL proofs enabled. Observe more than one worker. The same command with --maxWorkers=1 uses one worker.

## Context

Found during credit-admission verification. Two incomplete runs were stopped before restarting with an explicit worker flag. This command-boundary issue is distinct from the existing fixture-isolation report about the runtime-cutover singleton. No production data or services are involved.

---
title: 'device-syncd maximum-cardinality backfill test sits at the 60s timeout under test:diff'
severity: 'minor'
---

## Expected Behavior

`pnpm test:diff` should pass for a change that does not touch device-syncd code paths, and a long-running device-syncd test should either finish well inside its timeout or declare a larger one.

## Current Behavior

`test/junction-blood-pressure-backfill.test.ts` > "maximum-cardinality schedule-time history queries 396 keys once and offers one inactive root" runs about 55s of test time when the file is executed alone, which is inside the default 60s vitest timeout. Under `test:diff`, where several affected package suites run concurrently, the same test reports `Test timed out in 60000ms` (observed at 60.6s and 76s on two consecutive runs), which fails the whole lane. The file passes (107/107) when run alone.

## Possible Solution

Give the maximum-cardinality case an explicit larger timeout, or reduce its fixture size so it finishes with margin under parallel load.

## Minimal Reproducible Example

1. Make an unrelated change in `packages/importers` (device-syncd depends on the workspace package, so it becomes an affected package).
2. Run `pnpm test:diff`.
3. Observe the device-syncd maximum-cardinality test timing out at 60s while the file passes with `pnpm --dir packages/device-syncd exec vitest run test/junction-blood-pressure-backfill.test.ts`.

## Context

Blocks a clean `test:diff` exit for importer-only changes; the failure is unrelated to the change under test and costs a re-run plus manual isolation to prove it.

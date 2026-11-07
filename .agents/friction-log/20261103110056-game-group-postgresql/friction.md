---
title: 'Game group PostgreSQL proof leaves untracked metrics in the checkout'
severity: 'minor'
issue: 'cobuildwithus/murph#4520'
---

## Expected Behavior

Running the focused PostgreSQL group proof leaves the checkout clean or writes diagnostic metrics to an ignored, documented output directory.

## Current Behavior

The group load case writes `.tmp-pr4-load.json` in the repository root and leaves it untracked after the suite passes. Completion requires a manual ownership check and cleanup.

## Possible Solution

Use the test's temporary directory with cleanup, or an existing ignored artifact directory when the measurements should survive the run.

## Minimal Reproducible Example

With an isolated migrated local test database, run `MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm --dir apps/web test test/game-groups-postgres.test.ts`, then `git status --short`.

## Context

The file writer is in `apps/web/test/game-groups-postgres.test.ts`. This appeared while running the required game compatibility checks for Prove it; the product implementation does not use the metrics file.

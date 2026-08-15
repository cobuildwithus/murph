---
title: 'Diff verification can run CLI command tests against stale test-runtime builds'
severity: 'minor'
issue: 'cobuildwithus/murph#1739'
---

## Expected Behavior

`pnpm test:diff:local` should prepare every affected package runtime artifact before it starts CLI tests that spawn repository binaries.

## Current Behavior

After a source-only change in an affected runtime package, diff verification reached the CLI command suite with stale compiled runtime artifacts. Multiple otherwise unrelated command tests reached their 60-second timeout and a nested worker chain remained asleep after the test failures. Running `pnpm build:test-runtime:prepared` first made the same isolated CLI file pass all 38 tests, matching a freshly prepared detached base worktree.

## Possible Solution

Make the diff-verification owner run the test-runtime preparation step before affected CLI package tests, or make those command tests invoke source-safe entrypoints that cannot observe stale workspace builds.

## Minimal Reproducible Example

Modify an affected runtime package without rebuilding, run `pnpm test:diff:local`, and observe CLI command timeouts. Then run `pnpm build:test-runtime:prepared` followed by `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/assistant-cli.test.ts`; the isolated file completes successfully.

## Context

Broad PR verification spent substantial time in false command timeouts and required exact process-tree diagnosis before the source patch could be cleared.

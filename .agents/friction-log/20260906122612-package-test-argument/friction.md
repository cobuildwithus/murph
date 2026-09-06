---
title: 'Package test argument separator drops focused Vitest filters'
severity: 'minor'
issue: 'cobuildwithus/murph#3001'
---

## Expected Behavior

Running a package test script with named files after the conventional argument separator should select only those files.

## Current Behavior

The Assistant Engine test script appends those arguments after a literal separator in the Vitest command. Vitest runs the whole package suite instead of the requested files, adding several minutes of unrelated verification.

## Possible Solution

Document the direct package exec invocation for focused checks, or normalize the test script's forwarded arguments before invoking Vitest.

## Minimal Reproducible Example

Run `pnpm --dir packages/assistant-engine test -- model-behavior.test.ts`. The effective command is `vitest run --config vitest.config.ts --no-coverage -- model-behavior.test.ts` and selects the whole package. `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage model-behavior.test.ts` preserves the file filter.

## Context

Focused prompt verification unexpectedly ran unrelated tests. No product or private data is needed to reproduce this command-routing issue.

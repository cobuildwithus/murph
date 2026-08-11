---
title: 'Single-file hosted Web tests still fan out through the full Vitest workspace'
severity: 'minor'
---

## Expected Behavior

Passing one hosted Web test file through the package test wrapper should run only that file in its owning Vitest project, or the wrapper should print the exact project-scoped command to use.

## Current Behavior

The package wrapper starts the full workspace project fanout before reaching the requested file. In the observed run, the wrapper spent more than ten minutes cycling workers, while the equivalent command constrained with `--project hosted-web-store-config` completed the same 12 tests in 2.2 seconds.

## Possible Solution

Teach the hosted Web test wrapper to infer the owning project for an exact file argument and pass the matching `--project` value to Vitest.

## Minimal Reproducible Example

Run `pnpm --dir apps/web test:prepared -- imessage-nutrition-card-image.test.tsx`, then compare it with `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage --project hosted-web-store-config apps/web/test/imessage-nutrition-card-image.test.tsx`.

## Context

Focused PR verification should remain narrow and fast enough to iterate without weakening the tested route and rendering behavior.

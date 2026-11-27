---
title: 'Cloudflare Vitest finds no tests when run from the app directory'
severity: 'minor'
issue: 'cobuildwithus/murph#5048'
---

## Expected Behavior

`pnpm --dir apps/cloudflare exec vitest run test/<file>.test.ts` runs that test file, the way the same command does for `packages/assistant-engine` and `packages/hosted-execution`.

## Current Behavior

It exits 1 with "No test files found": `apps/cloudflare/vitest.config.ts` sets `include: apps/cloudflare/test/**/*.test.ts`, a path relative to the repository root, so a filter relative to the app directory never matches. Running from the repository root with `--config apps/cloudflare/vitest.config.ts apps/cloudflare/test/<file>.test.ts` works.

## Possible Solution

Resolve the include and exclude globs against the config file's directory (or set `root`), or document the root-relative command in `agent-docs/references/testing-ci-map.md` beside the other package commands.

## Minimal Reproducible Example

From a hydrated checkout: `pnpm --dir apps/cloudflare exec vitest run test/runner-supervised-invocation.test.ts --no-coverage` exits 1 with no tests; `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/runner-supervised-invocation.test.ts` passes.

## Context

Hit while verifying a recap media allowance change. An earlier recap score task recorded the same wrong-project selection, so focused Cloudflare proof costs a failed first run.

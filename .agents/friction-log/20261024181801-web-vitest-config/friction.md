---
title: 'Web Vitest config finds no tests when run from apps/web with app-relative paths'
severity: 'minor'
---

## Expected Behavior

Running `pnpm exec vitest run --config vitest.config.ts test/<file>.test.ts` from `apps/web` runs that focused Web test file, or the error says the config resolves include globs from the repository root.

## Current Behavior

Vitest prints "No test files found" and exits 1, because the Web config's include globs are repository-root relative (`apps/web/test/**`). The same file runs from the repository root with `--config apps/web/vitest.config.ts apps/web/test/<file>.test.ts`.

## Possible Solution

Set the config `root` so app-relative paths work, or document the root-relative focused-test command next to the `test:prepared` script.

## Minimal Reproducible Example

1. `cd apps/web`
2. `pnpm exec vitest run --config vitest.config.ts test/game-rules.test.ts`
3. Observe "No test files found".

## Context

Hit while running focused game rule tests for a Web backend fix; cost one retry from the repository root.

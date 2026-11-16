---
title: 'Direct Web Vitest runs fail in a fresh worktree until changelog fragments are generated'
severity: 'minor'
issue: 'cobuildwithus/murph#4965'
---

## Expected Behavior

The focused command the testing map documents, `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/<file>`, runs any Web test in a freshly created worktree after install and the workspace build.

## Current Behavior

A test whose import graph reaches `apps/web/src/lib/changelog.ts` fails at collection with `Cannot find module './changelog-fragments.generated'`. The file is gitignored and only `pnpm --dir apps/web changelog:generate` (run by `test:prepared` and `typecheck:prepared`) writes it. The failure reads like a broken test, and other files in the same run pass.

## Possible Solution

Generate the fragments in the shared Vitest global setup when the file is missing, or name `changelog:generate` beside the direct-run command in `agent-docs/references/testing-ci-map.md`.

## Minimal Reproducible Example

1. `scripts/create-worktree --codex-worktree murph-example -b example origin/main`
2. `pnpm install --prefer-offline && pnpm build:workspace:incremental`
3. `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-account-data-service.test.ts`

## Context

Hit while adding a table to the account-deletion inventory. One extra command once found; the cost is reading a collection error as a real failure.

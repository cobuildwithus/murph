---
title: 'Fresh Web typecheck requires an undeclared device-syncd service build'
severity: 'minor'
issue: 'cobuildwithus/murph#2914'
---

## Expected Behavior

After a frozen dependency install, the hosted Web typecheck should prepare or resolve every public workspace entrypoint used by its source and tests.

## Current Behavior

In a fresh worktree, `pnpm --dir apps/web typecheck` fails in `test/device-sync-hosted-runtime-authority.test.ts` because `@murphai/device-syncd/service` resolves to absent built declarations. The Web TypeScript configuration maps many other device-syncd entrypoints to source but omits this public service entrypoint. The typecheck command does not build the package.

## Possible Solution

Keep the Web workspace entrypoint resolution complete, or make the required build preparation explicit in the typecheck command.

## Minimal Reproducible Example

1. Create a fresh sanctioned worktree.
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm --dir apps/web typecheck`.
4. Observe TS2307 for `@murphai/device-syncd/service`.
5. Run `pnpm --dir packages/device-syncd build` to prepare the missing declared public entrypoint before retrying.

## Context

This adds a package-build prerequisite to an otherwise unrelated test-maintenance task and obscures the focused typecheck result.

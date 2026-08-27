---
title: 'Fresh worktree Web typecheck cannot resolve the generated Prisma client'
severity: 'minor'
---

## Expected Behavior

After the documented Prisma generation step succeeds, the hosted Web typecheck should resolve the generated `@prisma/client` declarations.

## Current Behavior

In a fresh sanctioned worktree, Prisma generation succeeds and a runtime import exposes `PrismaClient` and the generated enums. The canonical TypeScript 7 Web runner still reports that those exports do not exist across unrelated application and test files. Running the app-local TypeScript 5.9 compiler as a fallback exhausts its 4 GB heap before completing.

## Possible Solution

Add a focused generated-client resolution preflight for the TypeScript 7 runner, or make the worktree generation/link contract produce the module shape that the runner resolves.

## Minimal Reproducible Example

1. Create a sanctioned worktree and install with the frozen lockfile.
2. Run `pnpm --dir apps/web prisma:generate`.
3. Confirm a runtime import of `@prisma/client` exposes `PrismaClient`.
4. Run `pnpm --dir apps/web typecheck:prepared`.
5. Observe missing-export errors for the generated Prisma types.

## Context

This blocks the required Web typecheck for a frontend-only change even though focused component and Playwright checks pass.

---
title: 'Cloudflare typecheck fails in a fresh worktree until the web Prisma client is generated'
severity: 'minor'
issue: 'cobuildwithus/murph#4053'
---

## Expected Behavior

After `scripts/create-worktree` and `pnpm install --frozen-lockfile`, `pnpm --dir apps/cloudflare typecheck` passes on an unmodified checkout.

## Current Behavior

The Cloudflare typecheck includes `apps/web/test/support/hosted-runtime-migration-testkit.ts`, which imports `Prisma` and `PrismaClient` from `@prisma/client`. In a fresh worktree the client is not generated, so the typecheck fails with TS2305/TS7006 errors unrelated to the change under test.

## Possible Solution

Generate the Prisma client during worktree setup or install, or document `pnpm --dir apps/web prisma:generate` as a prerequisite for the Cloudflare typecheck.

## Minimal Reproducible Example

Create a fresh task worktree from origin/main, run `pnpm install --frozen-lockfile`, then `pnpm --dir apps/cloudflare typecheck`.

## Context

Hit while verifying an egress-only change; `pnpm --dir apps/web prisma:generate` resolves it.

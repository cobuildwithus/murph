---
title: 'Cloudflare app typecheck fails on ungenerated Web Prisma client'
severity: 'minor'
---

## Expected Behavior

`pnpm --dir apps/cloudflare typecheck` either generates or clearly requires the hosted-Web Prisma client it source-checks, so a fresh or reused checkout gets an actionable message.

## Current Behavior

In a checkout whose Web Prisma client has not been generated for the current schema, the app-local typecheck fails inside `apps/web/test/support/hosted-runtime-migration-testkit.ts` with `TS2305: Module '"@prisma/client"' has no exported member 'PrismaClient'` and follow-on implicit-any errors. Nothing points at the missing generation step; the root `pnpm typecheck` performs that generation first, but the documented focused command does not.

## Possible Solution

Have the Cloudflare typecheck run (or check for) `pnpm --dir apps/web prisma:generate` before source-checking Web-owned Prisma modules, or fail early with a message naming that command.

## Minimal Reproducible Example

1. Use a checkout where `pnpm --dir apps/web prisma:generate` has not been run for the current schema.
2. Run `pnpm --dir apps/cloudflare typecheck`.
3. Observe TS2305 for `PrismaClient`; running `pnpm --dir apps/web prisma:generate` first makes the same command pass.

## Context

Hit while running the focused verification for a small `apps/cloudflare` change; required a manual generate step to obtain a truthful typecheck result.

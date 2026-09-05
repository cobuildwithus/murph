---
title: 'Fresh worktree Web typecheck requires an undeclared device-syncd service artifact'
severity: 'minor'
issue: 'cobuildwithus/murph#2907'
---

## Expected Behavior

The documented Web typecheck command succeeds after dependency installation and its own generated-data prerequisites in a fresh task checkout.

## Current Behavior

Web typecheck fails with TS2307 for `@murphai/device-syncd/service` in `apps/web/test/device-sync-hosted-runtime-authority.test.ts`. That subpath is publicly exported to `dist/service.d.ts`, but the Web TypeScript source aliases cover the neighboring device-syncd entrypoints without covering service, and the Web typecheck command does not build the package artifact.

## Possible Solution

Give the Web typecheck an explicit artifact preparation dependency or include the public service entrypoint in its established source-alias owner, with a fresh-checkout regression check.

## Minimal Reproducible Example

In a fresh repository checkout, run `pnpm install --frozen-lockfile`, then `pnpm --dir apps/web typecheck`. The Web command completes Health Commons and Prisma generation before failing on the missing service declaration.

## Context

Focused connected-app tests pass, but the missing unrelated declaration blocks the full Web typecheck for a narrow assistant background-work change.

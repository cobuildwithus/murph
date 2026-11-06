---
title: 'Generated workflow route fails the machine route inventory test locally'
severity: 'minor'
---

## Expected Behavior

`apps/web/test/vercel-machine-route-firewall.test.ts` should give the same result in a checkout that has run the Web dev server as it does in a clean one.

## Current Behavior

The dev server's workflow compiler writes `apps/web/app/.well-known/workflow/v1/webhook/[token]/route.js`, which is gitignored. The test reads every route on disk, treats that file as an unclassified machine webhook, and fails with `Unclassified machine ingress`. `pnpm test:diff` then exits 1 for a reason unrelated to the diff.

## Possible Solution

Make the route inventory skip gitignored generated routes, or classify the generated workflow route explicitly.

## Minimal Reproducible Example

Run the Web dev server once in a worktree, then run `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/vercel-machine-route-firewall.test.ts`. It fails. Move only `apps/web/app/.well-known/workflow` aside and all 25 tests pass.

## Context

A clean diff reads as a failed local gate, and time goes to proving the failure is unrelated.

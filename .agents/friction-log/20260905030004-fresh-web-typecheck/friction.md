---
title: 'Fresh Web typecheck needs an undeclared device-syncd service build'
severity: 'minor'
issue: 'cobuildwithus/murph#2946'
---

## Expected Behavior

After a frozen workspace install and the Web typecheck's declared generation steps, Web typechecking should resolve the public workspace imports used by its tests.

## Current Behavior

`pnpm --dir apps/web typecheck` fails with TS2307 for `@murphai/device-syncd/service` in `test/device-sync-hosted-runtime-authority.test.ts`. The package exports that subpath from dist, while the Web source-path mappings cover other device-syncd subpaths but omit service. A fresh worktree has no service declaration output.

## Possible Solution

Complete the existing source-path mapping or explicitly prepare the required package boundary in the owning typecheck command.

## Minimal Reproducible Example

Use a new task worktree, run `pnpm install --frozen-lockfile --ignore-scripts`, then `pnpm --dir apps/web typecheck`. The generation steps complete before the missing service declaration error. Building device-syncd is the available local workaround.

## Context

This blocked the required Web typecheck for a content-only changelog entry. No production state or private data is involved.

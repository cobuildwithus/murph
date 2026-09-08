---
title: 'Production Next TypeScript check exceeds its fixed cold-check heap'
severity: 'minor'
issue: 'cobuildwithus/murph#2847'
---

## Expected Behavior

The canonical production Web build should complete its route-aware TypeScript check on the current source tree without requiring a separately warmed incremental cache.

## Current Behavior

The build runner fixes its TypeScript 5 heap at 3584 MiB and removes inherited heap overrides. The check exhausts that limit both during acceptance and when run alone with incremental caching disabled. The same project passes with a 6144 MiB heap and reports approximately 4.4 GiB of compiler memory. After that successful check writes incremental state, the unchanged canonical runner passes its TypeScript stage at its original limit.

## Minimal Reproducible Example

From apps/web, generate current route declarations, then run:

```sh
node --max-old-space-size=3584 node_modules/typescript/bin/tsc -p tsconfig.next.json --pretty false --incremental false
node --max-old-space-size=6144 node_modules/typescript/bin/tsc -p tsconfig.next.json --pretty false --extendedDiagnostics
bash scripts/run-production-next-build.sh
```

The first command exhausts its heap. The larger-heap check succeeds and permits the canonical build to reuse valid incremental state.

## Context

A documentation-only change cannot complete direct-push acceptance when the independently owned production build needs more cold-check memory. Workspace TypeScript 7 checks, package coverage, Web tests, lint, and dev smoke pass. Preserve the route-aware check and production build memory controls when addressing this gap.

The migration guard duplicated the previous heap literal after the runner and its dedicated behavioral test moved to 6144 MiB. Its focused non-mutating-build test then failed deterministically. Keep this guard aligned with the canonical runner; the heap correction does not change migration ownership.

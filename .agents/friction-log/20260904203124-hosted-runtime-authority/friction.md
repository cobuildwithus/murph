---
title: 'Hosted runtime authority test imports an undeclared device-syncd subpath'
severity: 'minor'
---

## Expected Behavior

The focused hosted Web typecheck resolves imports in the runtime authority tests through declared package entrypoints.

## Current Behavior

The runtime authority test imports SqliteDeviceSyncStore from @murphai/device-syncd/service, which is not a declared package export or Web TypeScript path. Typechecking fails with TS2307 although the Vitest source resolver accepts it.

## Minimal Reproducible Example

On the affected base, run pnpm --dir apps/web typecheck after ordinary workspace setup. The owning test file fails module resolution.

## Context

Fixed in this task by importing the already-exported store through @murphai/device-syncd. No package API change is needed.

---
title: 'Web integration tests inherit incompatible environment types when composing the runtime mailbox owner'
severity: 'minor'
---

## Expected Behavior

A test that calls Web and runtime owners can typecheck each owner in its declared environment.

## Current Behavior

A static import of the runtime mailbox fixture from a Web test makes TypeScript check the runtime environment builder under Next.js ambient types. The Web check reports TS2741 for NODE_ENV in hosted-runtime/environment.ts.

## Minimal Reproducible Example

Import prepareHostedSystemMailboxItemForCheckpoint through a runtime test helper in apps/web/test and run the Web typecheck. The same runtime source passes its package typecheck.

## Context

The connector integration proof needs both owners. A typed Vitest load keeps the Web and runtime checks separate.

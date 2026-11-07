---
title: 'Hosted maintenance tests share a fixed temporary vault across runs'
severity: 'minor'
---

## Expected Behavior

Concurrent test runs in separate task checkouts should use independent synthetic vaults and should not remove each other's runtime state.

## Current Behavior

The hosted-runtime maintenance suite uses a fixed `/tmp/vault-root` and recursively removes it in beforeEach. Independent invocations therefore share both runtime files and lock paths. A full package run encountered ENOENT while creating the assistant state directory. The affected dense-retention case passed when run alone with one worker. The shared path permits a cleanup race; the exact competing invocation was not identified.

## Possible Solution

Allocate a unique temporary vault per suite or test through the existing test lifecycle and pass that root to the maintenance calls and mailbox assertions.

## Minimal Reproducible Example

Run the assistant-runtime hosted-runtime-maintenance.test.ts suite concurrently in two task checkouts. Both beforeEach hooks target the same absolute temporary directory. One can remove the other's parent directory while its state writer is creating descendants.

## Context

This was encountered during complete assistant-runtime verification for an unrelated storage cleanup. The isolated affected cases passed; changing the maintenance fixture owner is outside that cleanup's scope.

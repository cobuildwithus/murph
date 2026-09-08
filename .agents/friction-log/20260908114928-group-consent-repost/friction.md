---
title: 'Group consent repost tests depend on an earlier describe block'
severity: 'minor'
---

## Expected Behavior

A focused group consent test runs independently with its own mock setup.

## Current Behavior

The chat-scoped suite clears mocks but does not initialize the current-offer
snapshot reader. Filtered repost tests reject with an undefined group read;
running the full file passes because an earlier describe block initializes it.

## Minimal Reproducible Example

Run `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-group-tool.test.ts -t 'explicit consent resend'` before the fixture correction, then run the whole file.

## Possible Solution

Initialize the snapshot reader in the chat-scoped beforeEach and keep the focused
repost scenario independently runnable.

## Context

Order-dependent setup obscures production-boundary regression proof.

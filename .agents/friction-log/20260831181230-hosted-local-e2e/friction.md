---
title: 'Hosted-local E2E does not preflight external Temporal protocol compatibility'
severity: 'minor'
---

## Expected Behavior

When hosted-local is given an external Temporal worker package, it should fail before stack startup if that package cannot parse the current checkout’s hosted-execution reconciliation contract.

## Current Behavior

A worker package resolving hosted-execution 1.3.1 starts against a 1.3.2 checkout. The foreground journey runs, then unrelated Environment cases wait for their full deadlines because the older exact-key parser rejects newer system-progress fields.

## Possible Solution

Add a secret-free startup handshake or package-contract preflight that proves the external worker accepts the current reconciliation facts schema before E2E scenarios start.

## Minimal Reproducible Example

1. Use the documented external Temporal worker package setting with a worker that resolves hosted-execution 1.3.1.
2. Run the hosted-local foreground-reply-priority E2E from a 1.3.2 checkout.
3. Observe that setup succeeds, reply-priority cases run, and later Environment cases time out on an invalid protocol response.

## Context

This delayed focused liveness verification and obscured successful reply-path evidence behind cross-version failures.

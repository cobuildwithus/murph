---
title: 'Standby claim late-settlement test races wall clock against timeout clock'
severity: 'minor'
---

## Expected Behavior

The standby claim budget test should exercise a real timeout and fallback, then deterministically record a claim settling after its captured deadline without invoking a second container.

## Current Behavior

The test resolves its synthetic late claim immediately after the real timeout returns. The timer can fire while Date.now still precedes the captured claim deadline by one millisecond, so the correctly derived deadline-expired diagnostic is false and required Cloudflare CI fails intermittently.

## Possible Solution

After the real timeout and fallback assertions, control Date.now at the captured claim deadline plus one millisecond before resolving the claim. Preserve the real timer, original budgets, and single-invocation assertion; restore the spy through the existing afterEach owner.

## Minimal Reproducible Example

In the existing standby claim budget test, let the real timeout complete, then set Date.now to the captured claim request deadline minus one millisecond before settling the deferred claim. The diagnostic reports a 999 ms elapsed claim and deadlineExpired=false despite the timeout fallback. Setting it to deadline plus one millisecond deterministically exercises the intended late settlement.

## Context

A test fixture clock race blocks the required Cloudflare job without demonstrating a production timeout or allocation defect.

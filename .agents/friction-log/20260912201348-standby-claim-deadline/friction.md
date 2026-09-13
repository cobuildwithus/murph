---
title: 'Standby claim deadline test depends on real-clock millisecond timing'
severity: 'minor'
---

## Expected Behavior

The foreground standby-claim deadline test should deterministically verify timeout and late-settlement behavior.

## Current Behavior

The timed-out scenario uses real wall-clock readings while asserting an exact 1000 ms remaining budget. A valid one-millisecond elapsed interval produces 999 ms and fails the Cloudflare CI job despite correct timeout behavior. The same unchanged focused test passes when both reads land in one millisecond.

## Possible Solution

Use a controlled test clock and advance the timeout explicitly, preserving the exact deadline and late-settlement assertions. Production deadline calculations remain unchanged.

## Minimal Reproducible Example

Run the foreground command-budget scenario in apps/cloudflare/test/hosted-runner-container-identity.test.ts under varying runner load. Inspect the claimed timeout budget when two consecutive wall-clock reads differ.

## Context

A pre-existing timing assertion blocked unrelated PR verification and required a test-only correction.

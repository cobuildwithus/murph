---
title: 'Linq audio abort replay fixture expires against the wall clock'
severity: 'minor'
issue: 'cobuildwithus/murph#3118'
---

## Expected Behavior

The hosted Linq audio parser-abort replay test should continue proving mailbox progress and one eligible assistant input regardless of the day it runs.

## Current Behavior

The fixed August 26, 2026 input timestamp reaches the real 14-day pending-input content retention cutoff on September 9. Background selection retires the synthetic input and returns an empty selection, so the replay assertion fails even though the incoming audio runtime and its configuration are unchanged. This blocks the required release coverage gate for an unrelated outbound retry correction.

## Possible Solution

Pin only the test's Date clock inside the fixture's retention window, keep asynchronous timers real, and restore the clock in finally. Preserve production retention and the replay assertions.

## Minimal Reproducible Example

On or after September 9, 2026 at 17:22:20 UTC, run `pnpm --dir packages/assistant-runtime test test/hosted-runtime-linq-audio-e2e.test.ts -t 'retries without advancing mailbox progress when stop aborts after the parser drain'` before applying the test-clock correction. Selection returns zero inputs where the fixture expects one.

## Context

The same isolated failure reproduced locally and in two CI candidates. A test-only fixed Date clock lets the complete three-case audio ingestion file pass without changing production source, retention policy, timers, or test expectations.

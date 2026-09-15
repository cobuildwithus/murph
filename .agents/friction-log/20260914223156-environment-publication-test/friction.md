---
title: 'Environment publication test counts work after its wake-classification window'
severity: 'minor'
---

## Expected Behavior

The scheduler-refresh integration case should prove that scheduler hints do not restart the initial Browser Vault write before it publishes.

## Current Behavior

The package coverage lane failed twice because the fixture counted every write and publication in the entire runtime invocation. Its first write published successfully across all three refresh hints; a later pass then published another snapshot. The runtime deliberately preserves unfinished wake classifications for replay after maintenance ends, so total invocation counts depend on scheduling beyond the intended assertion boundary.

## Possible Solution

Capture the write count at the first publication. Retain strict one-write and no-publication assertions for the foreground, failed-read, and incomplete-read interruption cases, plus the scheduler hint and read counts and final durable-state assertions.

## Minimal Reproducible Example

Run `pnpm --dir packages/assistant-runtime test:coverage` in the release coverage lane. The synthetic scheduler-refresh case can fail its global replica-write count after the initial write has already published. The focused case can pass on the same source under different scheduling.

## Context

This unrelated integration assertion blocked a mailbox latency release. Keep the correction confined to test observation; production wake replay behavior is unchanged.

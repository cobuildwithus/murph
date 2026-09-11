---
title: 'Audio abort-replay fixture ages out of pending-input retention'
severity: 'minor'
issue: 'cobuildwithus/murph#3126'
---

## Expected Behavior

The hosted Linq audio abort-replay test should prove that aborting after parser drain does not advance mailbox progress, and that replay makes exactly one assistant input eligible.

## Current Behavior

The test uses a fixed event timestamp while background input selection applies the current clock's fourteen-day content-retention window. Once that fixture date ages out, the replay input is retired and the expected eligible input list is empty. The package coverage shard fails despite no change to the tested production path.

## Possible Solution

Use a current synthetic event timestamp for this abort-replay fixture, preserving the existing retention implementation and all progress, deduplication, and parser assertions.

## Minimal Reproducible Example

Run the focused hosted-runtime-linq-audio-e2e test after its fixed event timestamp is more than fourteen days old. Background selection returns no eligible input after replay. Changing only the fixture timestamp to the current time keeps the abort-replay case within retention.

## Context

This blocked required platform package coverage during an unrelated container deployment change. The failure reproduced in focused local execution. No production behavior change is needed.

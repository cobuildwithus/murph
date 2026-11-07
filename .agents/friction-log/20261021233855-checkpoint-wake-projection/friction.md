---
title: 'Checkpoint wake projection fixture races a real timer'
severity: 'minor'
issue: 'cobuildwithus/murph#4299'
---

## Expected Behavior

The checkpoint projection test should deterministically make its runtime wake observable at the intended loop boundary and prove that the second assistant pass clears projected wake metadata before the checkpoint.

## Current Behavior

The fixture schedules a wake on a 10 ms real timer but does not synchronize its delivery with the runtime boundary. It can finish after only one assistant pass while asserting two. Moving the notification immediately into the first phase also does not establish the intended boundary, so simply changing or removing the delay is insufficient.

## Possible Solution

Queue the notification through the existing first phase afterCheckpoint hook, after the foreground mailbox watcher has stopped. The outer loop then absorbs the projection before consuming the queued wake. Preserve both passes, the slow second-pass scenario, the single checkpoint, and null final projected wake assertions. Do not modify production scheduling or expand time budgets.

## Minimal Reproducible Example

Run the case named `runtime wake pass can clear projected wake metadata before checkpoint` in `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint-checkpoint-races.test.ts`. In a temporary synthetic copy, hold only its first wake callback for 1000 ms instead of 10 ms. The runtime completes before that callback and the two-pass assertion fails. This is a controlled late-callback reproduction, not a claim that a 1000 ms delay was measured in CI.

## Context

A historical CI failure has the same one-pass assertion outcome. The issue is a fixture ordering assumption; a production scheduling defect has not been established. Existing wake-interrupt and provider-timeout friction entries cover different tests and contracts.

## Resolution

The test now uses that existing hook and asserts the intermediate projected wake plus event ordering through the second pass and only checkpoint. All 20 checkpoint-race tests and the assistant-runtime typecheck pass. Production scheduling and time budgets are unchanged.

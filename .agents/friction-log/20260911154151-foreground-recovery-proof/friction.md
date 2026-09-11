---
title: 'Foreground recovery proof rejects advanced mailbox frontiers and settled owners'
severity: 'minor'
---

## Expected Behavior

After foreground delivery, the hosted proof should accept successful seeded system work when its durable frontier advances or its original runtime owner finishes normally.

## Current Behavior

The recovery observer requires the imported and persisted mailbox frontiers to equal the initial seeded sequence and requires a processing receipt from the original attempt. A completion event can advance the frontier, and scheduled continuation can run after that attempt settles. The observer then rejects successful recovery.

## Minimal Reproducible Example

Seed system work through sequence 36. After provider start, process a seeded member action, append its completion event, and observe both frontiers at 37 with zero lag and zero retryable blocks. Attribute its successful processing receipt to the authorized successor attempt. The existing observer times out despite the completed work. Each of the advanced frontier and successor attempt independently reproduces rejection.

## Context

This affects only hosted release evidence. Preserve the exact owner at foreground provider start, the post-provider evidence boundary, and successful processing requirements while observing monotonic durable progress.

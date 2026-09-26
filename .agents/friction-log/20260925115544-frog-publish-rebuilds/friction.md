---
title: 'Frog publish rebuilds the repository issue index for every unchanged batch'
severity: 'minor'
---

## Expected Behavior

One reconciliation run should index each destination and trusted-author scope once while keeping its mutation ceiling.

## Current Behavior

Frog 1.1.0 creates a new matcher for every publish batch. Already-linked reports consume no mutation slots, so a large linked backlog repeatedly scans the same repository and the scheduled job can exceed its ten-minute timeout.

## Minimal Reproducible Example

Prepare twelve synthetic linked reports with unchanged revision markers and a maximum of five mutations. Publish the reports through the same prepared client in three batches. The unpatched publisher requests the repository issue index three times instead of once.

## Context

The scheduled reconciliation job times out before reporting its result. The registry patch retains the mutation ceiling and isolates caches by destination, label, and trusted author, including issues created earlier in the same invocation.

---
title: 'ReviewGPT waited capture misses a completed response on its owned target'
severity: 'minor'
target: 'cobuildwithus/review-gpt'
---

## Expected Behavior

A waited ReviewGPT run should capture and return an assistant response that already contains the required completion marker on its exact owned browser target.

## Current Behavior

The assistant response completed with the required marker on the owned target, but the waited command remained blocked for more than an hour and never wrote the response file. Recovery required reading the exact target directly through its configured managed-browser endpoint, then interrupting only the task-owned command tree.

## Possible Solution

After each poll, query the exact owned target for the latest assistant message and accept a stable marker-bearing response even when the normal page event or response observer was missed. Persist the target and conversation receipt before waiting so recovery does not depend on rediscovering the browser lane.

## Minimal Reproducible Example

1. Start a waited PR review on a named managed-browser lane.
2. Let the exact owned target finish with the configured completion marker.
3. Observe that the command continues waiting and the response file remains absent.
4. Read the same target through its CDP endpoint and observe the complete marker-bearing response.

## Context

This delayed mandatory exact-head review remediation and made the command appear unfinished even though the reviewer had already returned a material finding.

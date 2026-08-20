---
title: 'Concurrent ReviewGPT stages can select the same browser lane'
severity: 'minor'
---

## Expected Behavior

When the completion-specialists and final PR-review stages start concurrently, automatic lane selection atomically reserves two distinct usable managed browser lanes.

## Current Behavior

Two independently launched ReviewGPT commands can both select the same managed browser lane before either process makes that lane unavailable. The accepted review turns then run concurrently in separate tabs of one profile even though the completion workflow requires separate lanes.

## Possible Solution

Serialize automatic lane selection and reservation across ReviewGPT wrapper processes, and hold the reservation until the owned review target completes or fails.

## Minimal Reproducible Example

1. Start `review:gpt completion-specialists --wait` and `review:gpt pr-review --wait` concurrently from one clean exact-head PR worktree without explicit lane pins.
2. Inspect the managed browser endpoint reported by both processes.
3. Observe that both can report the same endpoint and profile.

## Context

This adds avoidable cross-stage interference risk to the standard PR completion workflow.

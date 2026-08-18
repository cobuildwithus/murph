---
title: 'Assistant-engine umbrella tests exceed the default worker heap'
severity: 'minor'
---

## Expected Behavior

The package test command should complete within its configured worker memory budget or provide a documented bounded-concurrency lane.

## Current Behavior

Running the assistant-engine package test command exhausts a worker near the default heap limit. The test runner then times out while terminating that worker and does not exit without interrupting the exact session.

## Possible Solution

Configure a bounded worker count or per-worker heap budget for this package's canonical test command.

## Minimal Reproducible Example

From a normal prepared worktree, run `pnpm --filter @murphai/assistant-engine test`.

## Context

This forced verification to use the directly affected test file even though that focused suite passed.

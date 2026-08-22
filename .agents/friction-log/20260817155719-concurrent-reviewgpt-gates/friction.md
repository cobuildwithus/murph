---
title: 'Concurrent ReviewGPT gates race while refreshing origin/main'
severity: 'minor'
---

## Expected Behavior

The required preliminary specialist and final ReviewGPT gates can start concurrently against one clean pushed PR head without competing over Git remote-tracking refs.

## Current Behavior

When both canonical ReviewGPT commands begin together, their preparation can refresh the same remote-tracking ref concurrently. One process can fail with a Git ref-lock compare-and-swap error before browser submission, forcing callers to serialize packaging even though the review workflow requires the resulting audits to run concurrently.

## Possible Solution

Coordinate the guarded fetch/preflight phase under one repository-local lock, fetch once before both packages, or treat a concurrently advanced remote-tracking ref as a retryable preparation condition.

## Minimal Reproducible Example

1. Use a clean task branch whose pushed head matches an open pull request.
2. Start the canonical completion-specialists and round-one pr-review commands at the same time.
3. Observe that one preparation can fail while updating the same origin/main remote-tracking ref.

## Context

The completion workflow deliberately launches both review stages against the same exact pushed head. Serializing only their preparation is a safe workaround, but the canonical concurrent path should not require caller orchestration.

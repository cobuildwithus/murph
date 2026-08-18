---
title: 'ReviewGPT named lane can stall in unbounded Spotlight lookup from a task worktree'
severity: 'minor'
---

## Expected Behavior

A named ReviewGPT browser lane should launch promptly from an authorized task worktree, or fail with a bounded actionable error when its local profile-app marker is absent.

## Current Behavior

When the task worktree does not contain the ignored profile app bundle, `scripts/review-gpt.config.sh` runs `mdfind ... | head -n 1` without a timeout. The lookup can remain blocked before the browser launches, producing no review capture or diagnostic.

## Possible Solution

Avoid requiring the ignored app marker when the installed browser binary and isolated user-data directory are already available, or bound the metadata lookup and fail fast.

## Minimal Reproducible Example

1. Create an authorized task worktree without copied ignored ReviewGPT profile app bundles.
2. Run a PR review with `REVIEW_GPT_BROWSER_LANE=phlebas`.
3. Observe the config compatibility process waiting in the Spotlight lookup before any browser endpoint opens.

## Context

This blocked a required PR review recovery until the exact owned process was interrupted and a local lane marker was created for a different managed profile.

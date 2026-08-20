---
title: 'Runner bundle budget can lag clean current main'
severity: 'minor'
---

## Expected Behavior

The checked-in production runner total-byte budget should admit a clean current-main bundle while retaining its documented headroom for the next reviewed change.

## Current Behavior

A clean current-main assembly exceeded the checked-in total-byte budget, so a device-sync change appeared to fail the production bundle gate even though most of the measured growth already existed on the base branch.

## Possible Solution

Measure and ratchet the budget whenever merged runner-graph changes increase the clean-base bundle, and keep the baseline tied to an exact clean commit rather than the candidate that first exposes the drift.

## Minimal Reproducible Example

1. Check out the exact current-main commit in an isolated sanctioned worktree.
2. Run `pnpm --dir apps/cloudflare runner:bundle`.
3. Observe that build and parity probes succeed before the total-byte assertion rejects the clean-base output.

## Context

The stale budget required a separate clean-base production assembly to distinguish existing base growth from the task delta before the candidate could be reviewed safely.

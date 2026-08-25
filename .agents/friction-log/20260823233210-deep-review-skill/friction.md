---
title: 'Deep-review skill requires removed coordination ledger'
severity: 'minor'
issue: 'cobuildwithus/murph#2221'
---

## Expected Behavior

The Murph deep-review skill should route reviewers through current ownership surfaces: task worktrees, branches, pull requests, and active execution plans.

## Current Behavior

Its preflight requires `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, but the repository intentionally deleted that file and removed all live workflow dependencies on it. Reviewers must discover the historical removal plan before continuing.

## Possible Solution

Remove the stale ledger step from the deep-review skill and point to the active execution plan when task ownership context is needed.

## Minimal Reproducible Example

1. Start a Murph deep review.
2. Follow the skill preflight.
3. Attempt to read the required coordination ledger.
4. Observe that the guarded path does not exist by design.

## Context

This creates a predictable documentation detour during final code review without adding any ownership safety.

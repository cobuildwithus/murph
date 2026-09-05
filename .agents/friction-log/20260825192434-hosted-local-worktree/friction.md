---
title: 'Hosted-local worktree startup cannot select the Cloudflare account'
severity: 'minor'
issue: 'cobuildwithus/murph#2726'
---

## Expected Behavior

The hosted-local worktree command selects the repository Cloudflare account and starts non-interactively.

## Current Behavior

When the local Wrangler login can access more than one account, worktree startup exits before the stack becomes healthy because no account is selected.

## Possible Solution

Pass the reviewed project account through the hosted-local worktree configuration.

## Minimal Reproducible Example

1. Log Wrangler into two synthetic accounts.
2. Run the hosted-local worktree startup command.
3. Observe that the Cloudflare child exits before the Web stack remains available.

## Context

This blocks local full-stack browser proof from a task worktree and forces the documented frontend-only lane.

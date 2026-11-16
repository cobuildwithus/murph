---
title: 'create-worktree at the regular-worktree ceiling gives no path to a free slot'
severity: 'minor'
---

## Expected Behavior

When `scripts/create-worktree` refuses because the regular-worktree ceiling is
reached, it should say how to free a slot: for example, list registered
worktrees whose exact PR head is already merged or closed (the ones
`scripts/retire-worktree --dry-run` would accept), or print that command.

## Current Behavior

It prints `new worktree would exceed the ratcheted ceiling of 200 (regular=200, data=5)`
and exits. Nothing says which checkouts are retire-eligible, so an agent has to
list every worktree, look up each branch's PR state by hand, and dry-run
retirement candidates one at a time. Retiring a checkout another session
created also needs explicit operator approval, so the task stalls until that
approval arrives.

## Possible Solution

On a ceiling refusal, run the same eligibility check `retire-worktree --dry-run`
uses over registered worktrees (bounded, read-only) and print the eligible
paths, or at least point to that command.

## Minimal Reproducible Example

1. Have 200 registered regular worktrees, several of them on merged PRs.
2. Run `scripts/create-worktree --codex-worktree murph-example -b example origin/main`.
3. Observe the refusal with no list of eligible checkouts.

## Context

A device-sync bug fix could not start for most of a session because the
machine sat at exactly 200 worktrees, most of them on merged PRs.

---
title: 'Retire-worktree cannot retire a clean detached benchmark checkout'
severity: 'minor'
---

## Expected Behavior

The mandated worktree retirement helper should safely retire a clean inactive detached checkout after its exact commit is identified as disposable, while preserving every branch and enforcing the usual process, cleanliness, registration, and active-reference checks.

## Current Behavior

A clean detached benchmark checkout has no local branch, so `scripts/retire-worktree` refuses it at the branch-backed gate. The checkout must remain registered and consumes one guarded worktree slot even after the benchmark is complete.

## Possible Solution

Add a narrowly gated detached-checkout retirement mode that requires an exact clean detached commit, no branch deletion, no active references or processes, and explicit terminal authorization.

## Minimal Reproducible Example

1. Create a sanctioned temporary benchmark checkout at an exact commit without attaching a local branch.
2. Complete the read-only benchmark and confirm the checkout is clean and inactive.
3. Run `scripts/retire-worktree <target>` from another checkout.
4. Observe the branch-backed refusal even though no branch could be lost.

## Context

The required helper correctly fails closed, but the missing detached-checkout lifecycle leaves completed exact-base benchmark worktrees stranded and consumes global worktree capacity.

---
title: 'Direct-push workflow stops for a meaning-preserving docs conflict'
severity: 'minor'
---

## Expected Behavior

An authorized push can resolve a bounded documentation conflict, preserve both changes, and continue after focused verification.

## Current Behavior

The direct-push rule requires a conflict-free post-acceptance rebase and stops even when only a documentation index description overlaps. Previously completed verification cannot be carried forward without another user handoff.

## Possible Solution

Allow bounded conflict resolution within the authorized scope. Inspect the resulting patch and upstream changes, and rerun affected checks while preserving the existing moving-base budget.

## Minimal Reproducible Example

Verify a candidate that updates a docs-index description. Advance the remote with another edit to that description, then rebase the candidate. The prior rule requires stopping despite a meaning-preserving combined description.

## Context

This policy adds a redundant approval step to an already authorized push.

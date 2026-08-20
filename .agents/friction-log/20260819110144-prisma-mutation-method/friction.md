---
title: 'Prisma mutation-method changes can silently stale concurrency pause hooks'
severity: 'minor'
---

## Expected Behavior

PostgreSQL lock-order regression tests should continue intercepting the production compare-and-swap boundary when its Prisma mutation method changes.

## Current Behavior

A production optimization changed a dirty-connection compare-and-swap from `updateMany` to `updateManyAndReturn`, while the concurrency test proxy still intercepted only `updateMany`. The test then waited for an unreachable pause signal until its transaction timeout and obscured the actual lock-order proof.

## Possible Solution

Keep the pause helper aligned with every supported compare-and-swap mutation method, or expose a narrow test seam at the semantic boundary.

## Minimal Reproducible Example

Run the dirty-state PostgreSQL account-deletion concurrency test with `MURPH_TEST_POSTGRES_CONCURRENCY=1`; the first two cases time out while awaiting the stale proxy hook.

## Context

The private pre-merge integration matrix found this after the method optimization had already reached the default branch.

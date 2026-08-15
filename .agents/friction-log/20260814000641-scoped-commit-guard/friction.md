---
title: 'Scoped commit guard is blocked by unrelated temporary clones'
severity: 'minor'
issue: 'cobuildwithus/murph#1816'
---

## Expected Behavior

A commit from an authorized registered worktree should continue when a separate standalone temporary clone appears. The guard should report the clone without making the current task responsible for it.

## Current Behavior

The scoped pre-commit guard exits nonzero when its machine-local unmanaged-clone inventory detects a new matching checkout anywhere in the configured temp roots.

## Possible Solution

Keep the explicit global audit fail-closed, but let scoped authorized operations warn without admitting the new clone into the legacy ratchet baseline.

## Minimal Reproducible Example

Initialize an empty unmanaged-clone baseline, create a synthetic same-origin standalone clone in a configured temp root, then commit an unrelated tracked-file change from an authorized registered checkout.

## Context

This prevents machine-wide temporary checkout residue from coupling independent task commits while preserving global cleanup visibility.

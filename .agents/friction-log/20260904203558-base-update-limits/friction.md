---
title: 'Base-update limits stop authorized shipping after routine main movement'
severity: 'minor'
issue: 'cobuildwithus/murph#2919'
---

## Expected Behavior

Continue necessary base reconciliation within existing merge authorization, preserving review, required CI, and published history.

## Current Behavior

The review and verification guides imposed one-update or one-rebase budgets. A second main advance forced a stop and another prompt even for mechanical conflicts with no new product or authority decision.

## Possible Solution

Remove the numerical budgets from their owning guides. Inspect intervening changes and conflict resolutions, rerun affected checks, and require CI on each changed PR head. Retain acceptance whenever changed behavior invalidates prior proof.

## Minimal Reproducible Example

Prepare an authorized reviewed PR, update its base once, then advance main again with a documentation edit. The former rules stop delivery even when the resolution simply preserves both descriptions.

## Context

This change removes the workflow stop while retaining the verification and authorization boundaries.

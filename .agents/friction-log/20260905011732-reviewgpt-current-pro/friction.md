---
title: 'ReviewGPT current Pro alias fails concrete-model response validation'
severity: 'minor'
---

## Expected Behavior

The repository review command should select and validate the same current ChatGPT Pro model, retaining a completed exact-turn review without an avoidable capture failure.

## Current Behavior

The repository config sets gpt-5.6-sol, which the installed ReviewGPT CLI describes as a current-Pro alias. Model selection chooses the current Pro surface, but response validation still expects the literal configured model and rejects the current Pro response metadata after the review completes.

## Minimal Reproducible Example

Run the repository's normal waited PR review on a signed-in current-Pro lane. Selection succeeds and the review completes, but concrete-model validation rejects the current model metadata against the alias. The guarded response and exact-turn capture metadata remain available locally for recovery.

## Context

This blocks the final review gate and can lead to a duplicate full review. Keep alias selection and response validation consistent in the owning ReviewGPT package; use an explicit supported current-model target for an individual retry.

Resolved for the current candidate by merging main and installing its frozen lockfile: ReviewGPT 0.5.145 and the repository config both target gpt-6-pro. The earlier failed capture still cannot serve as a passing final gate.

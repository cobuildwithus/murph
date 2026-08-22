---
title: 'PR launch guidance splits body guards from the ReviewGPT baseline'
severity: 'minor'
---

## Expected Behavior

The PR workflow should provide one ordered preflight that validates required body sections and the exact full ReviewGPT baseline before any review job starts.

## Current Behavior

The deployment and changelog requirements live in the PR-description guidance while the full-SHA baseline rule lives in the ReviewGPT loop. Following one section alone can launch a review with incomplete metadata, forcing an avoidable restart.

## Possible Solution

Keep a single ordered launch checklist in the PR-description guidance and have the ReviewGPT loop point to it. State explicitly that the baseline is the 40-character value from `git rev-parse HEAD`, never a shortened SHA.

## Minimal Reproducible Example

1. Prepare and push a clean PR candidate.
2. Follow the ReviewGPT launch section without cross-checking every PR-description requirement.
3. Start the review with a shortened commit identifier or a missing required body section.
4. Observe the attachment preflight or Pull Request Evidence fail after the review has already started.

## Context

This caused avoidable gate restarts while preparing an urgent internal package release.

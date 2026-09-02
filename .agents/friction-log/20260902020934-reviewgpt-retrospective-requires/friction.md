---
title: 'ReviewGPT retrospective requires an unrelated new PR head'
severity: 'minor'
---

## Expected Behavior

A required ReviewGPT retrospective recorded in the PR body should allow the next review round when the product code and reviewed head do not change.

## Current Behavior

The workflow says the retrospective can live in the PR body or a PR comment. The round packager also rejects every later round unless the PR head differs from the prior reviewed head. This forces an unrelated commit after a documentation-only retrospective.

## Possible Solution

Allow a later full-snapshot round on the same head when the prior outcome is `RETROSPECTIVE_REQUIRED` and the PR body now contains the required retrospective. Keep the immutable first-reviewed baseline and exact-head checks.

## Minimal Reproducible Example

1. Run round 1 on a large PR and receive `RETROSPECTIVE_REQUIRED`.
2. Record the complete requirement-level retrospective in the PR body.
3. Run round 2 with the original first-reviewed and previous-reviewed heads.
4. The packager rejects the run because the current head equals the previous head.

## Context

This blocks a review-only continuation and creates source-control churn that does not improve the product or the audit evidence.

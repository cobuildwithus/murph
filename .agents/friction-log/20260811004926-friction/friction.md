---
title: 'Generated Frog pull request bodies fail Murph metadata checks'
severity: 'minor'
---

## Expected Behavior

The repository-owned Frog reconciliation workflow should create a pull request that can pass Murph's required pull-request body validators without manual editing.

## Current Behavior

The pinned Frog action generates its own reconciliation summary but has no input for repository-specific body sections. Murph requires Architecture and reuse plus Changelog sections on every pull request, so the generated sync pull request starts with a failing required check.

## Possible Solution

Keep normalization in the existing Friction Log job: after Frog creates or updates the sync pull request, append a fixed Murph-compliant footer with the same short-lived App token and validate the exact footer in the workflow guard tests.

## Minimal Reproducible Example

1. Run the Friction Log workflow with a pending committed entry.
2. Let Frog create the `frog/sync` pull request.
3. Run the repository pull-request body validators against Frog's generated body.
4. Observe that the required Architecture and reuse and Changelog sections are absent.

## Context

Frog remains the only reconciliation owner, and the sync pull request remains human-reviewed. This mismatch is between a generic upstream action body and repository-specific mandatory metadata, not a failure in Frog's issue bookkeeping.

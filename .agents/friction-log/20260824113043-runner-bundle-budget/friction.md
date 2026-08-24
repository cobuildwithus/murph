---
title: 'Runner bundle budget rejects valid PR when main advances'
severity: 'minor'
---

## Expected Behavior

The pull-request runner bundle job should measure the exact GitHub-generated merge candidate and report whether that candidate builds within the production byte budget. A later unrelated update to the base branch should not invalidate the completed candidate measurement.

## Current Behavior

The job independently queries the live base branch before and after measurement and fails when that branch differs from the base captured in the immutable pull-request merge ref. Busy repositories can therefore fail before the bundle build starts, or after a successful build, solely because another change merged.

## Possible Solution

Trust the immutable pull-request merge ref selected by GitHub Actions, retain the exact candidate bundle measurement, and let repository mergeability plus required checks own admission at merge time.

## Minimal Reproducible Example

1. Start the pull-request workflow from a valid merge ref.
2. Advance the target branch before the runner bundle job reaches its live-base comparison.
3. Observe the job fail without measuring, or reject an otherwise successful measurement.

## Context

The redundant live-base checks caused repeated full CI retries while the underlying build and bundle-budget checks were healthy.

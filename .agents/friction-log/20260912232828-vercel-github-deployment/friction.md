---
title: 'Vercel GitHub deployment checks retain running after admission completes'
severity: 'minor'
---

## Expected Behavior

A Git-managed production candidate receives the final exact-commit admission result and receives production domains only after success.

## Current Behavior

GitHub Actions admission can complete successfully while its imported Vercel check remains running. The build stays staged. Publishing the same verified outcome through GitHub commit statuses updates the imported check to succeeded.

## Possible Solution

Publish explicit pending and final commit statuses from the existing admission workflow. Derive success from the completed proof job and retain the required deployment check.

## Minimal Reproducible Example

Run a protected-main admission workflow with a matching imported GitHub check. Compare the completed GitHub job with the still-running imported check. Re-publish the verified outcome for the same candidate SHA and context; observe the imported check settle.

## Context

Missing delivery of completed check results stalls verified releases and forces manual recovery.

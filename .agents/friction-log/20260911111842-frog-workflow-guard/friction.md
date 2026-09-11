---
title: 'Frog workflow guard test requires unauthenticated GitHub Markdown requests'
severity: 'minor'
---

## Expected Behavior

The repository tools unit suite should validate the generated Frog pull request footer with deterministic local fixtures and no network credentials.

## Current Behavior

The workflow guard test launches changelog and deployment validation CLIs. Both render the synthetic footer through GitHub's Markdown API, while the release test step supplies no rendering token. An HTTP 403 fails the release build independently of the footer contents.

## Possible Solution

Call the existing pure validation exports with synthetic rendered heading and list sections. Keep actual GitHub rendering in the trusted pull request evidence workflow.

## Minimal Reproducible Example

Run the Frog workflow guard suite in an environment without a rendering token and with the GitHub Markdown endpoint returning HTTP 403. The trusted-default-branch workflow case fails before its local footer checks can finish.

## Context

This network dependency blocked release verification for an unrelated feature. The task includes a local validator fixture correction and focused regression checks.

---
title: 'Automated continuation pushes can leave PR Actions on the previous head'
severity: 'minor'
---

A scoped follow-up commit pushed to an active pull-request branch should emit the ordinary synchronize event and start the repository's required pull-request workflows on that exact head.

## Current Behavior

The pull request head advanced and external check suites appeared, but the GitHub Actions workflows remained on the preceding head. The exact-head completion gate therefore required another scoped push even though the implementation commit was already complete.

## Possible Solution

Ensure automated continuation pushes use an authentication path that emits pull-request workflow events, or provide one supported exact-head workflow-dispatch entrypoint that produces the required check contexts.

## Minimal Reproducible Example

1. Start from an open pull request with completed checks.
2. Let an automated continuation commit and push a focused remediation to its branch.
3. Confirm that the pull request head advances.
4. Observe that external check suites are created while pull-request GitHub Actions runs remain attached only to the preceding head.

## Context

Exact-head CI is a completion requirement. A suppressed synchronize event forces an otherwise unnecessary follow-up commit or an unsafe pull-request state workaround.

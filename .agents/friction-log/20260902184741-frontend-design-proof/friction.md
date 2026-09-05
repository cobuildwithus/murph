---
title: 'Frontend design-proof fixture conflicts with privacy commit hook'
severity: 'minor'
---

## Expected Behavior

The frontend design-proof test should create its isolated Git fixture under the enforced repository privacy policy without extra caller configuration.

## Current Behavior

The test configures its fixture with a non-noreply email. The repository commit hook rejects the fixture setup commit, so pnpm test:frontend-design-proof fails before exercising the CLI behavior.

## Possible Solution

Configure the fixture with a neutral GitHub noreply address or explicitly supply a compliant fixture-local Git config.

## Minimal Reproducible Example

Run pnpm test:frontend-design-proof in a checkout where the repository privacy hook is active.

## Context

A frontend task required rerunning the check with a process-scoped neutral Git configuration so the unchanged test could reach its assertions.

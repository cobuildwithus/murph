---
title: 'Provider guard classifies GitHub controller HTTP as Temporal'
severity: 'minor'
issue: 'cobuildwithus/murph#2176'
---

## Expected Behavior

The provider request boundary guard distinguishes GitHub Actions control-plane HTTP from Temporal service HTTP even when the controller file and constants use the product term `temporal`.

## Current Behavior

`pnpm test:diff` reports `fetch()` calls to `https://api.github.com` as `Direct Temporal provider HTTP` because provider inference treats the controller path and constant names as provider evidence before resolving the URL host.

## Possible Solution

Prefer a statically resolved URL host over path and identifier fallback, or exclude a proven non-provider host such as `api.github.com` from provider-name inference.

## Minimal Reproducible Example

1. Add a repository script whose filename contains `temporal`.
2. In one named function, call `fetch()` with a GitHub API URL assembled from constants.
3. Run `pnpm provider-requests:guard`.
4. Observe a Temporal-provider violation for the GitHub request.

## Context

This forces an exact raw-provider exception or artificial renaming and refactoring for a GitHub CI controller that never calls the Temporal service.

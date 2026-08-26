---
title: 'Frog autofix fixtures use a privacy-rejected git email'
severity: 'minor'
issue: 'cobuildwithus/murph#2353'
---

## Expected Behavior

Repo-tools tests that create temporary Git repositories should use fixture identities accepted by the repository privacy hook.

## Current Behavior

Several Frog autofix tests configure a synthetic non-noreply email. Their temporary commits are rejected by the privacy hook, so unrelated `pnpm test:diff` runs fail and can remain alive after reporting the failures.

## Possible Solution

Use one approved synthetic noreply fixture identity for temporary Git repositories.

## Minimal Reproducible Example

Run the focused Frog autofix test named `preserves parent-local review ancestry and handoffs after a foreign body edit` through `scripts/vitest.config.ts`.

## Context

This reproduced without the candidate patch on the default branch while verifying an unrelated repo-tool runner change.

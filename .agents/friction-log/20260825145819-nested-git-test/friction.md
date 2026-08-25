---
title: 'Nested Git test fixtures inherit workspace privacy hooks'
severity: 'minor'
---

## Expected Behavior

Repository tests that initialize disposable nested Git repositories should use only their fixture-local Git configuration and hooks.

## Current Behavior

The globally installed workspace Git configuration is inherited by nested fixture repositories. Their synthetic commits are blocked by the workspace privacy hook before the behavior under test runs.

## Possible Solution

Have the shared Git-fixture helper isolate global and system Git configuration while preserving explicit fixture-local identity and hook setup.

## Minimal Reproducible Example

1. Install the repository Git hooks through the normal setup path.
2. Run the Frog autofix repository tests.
3. Observe nested fixture commits fail in the privacy hook.
4. Run the same tests with global Git configuration isolated and observe them pass.

## Context

This adds avoidable setup-specific failures to focused repository-tool verification and forces callers to know an undocumented test environment override.

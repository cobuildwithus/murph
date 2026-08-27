---
title: 'Release acceptance runs Linux Codex shell proof without CI markers'
severity: 'minor'
---

## Expected Behavior

Release acceptance should apply platform constraints to host-dependent Codex shell proofs regardless of which CI environment variables the executor preserves.

## Current Behavior

The scripted permission-shell test skips only when GitHub Actions Linux markers are present. A delegated Linux executor omits those markers, runs the workspace-installed Codex binary inside bubblewrap, and fails before the release can mutate versions.

## Possible Solution

Gate this workspace-binary shell proof by the actual host platform and keep native Linux confinement proof in the production runner image workflow.

## Minimal Reproducible Example

Run the assistant scripted-runtime suite on Linux with GitHub Actions variables unset.

## Context

A full release-acceptance run reached this test after all prior package checks passed and stopped without publishing.

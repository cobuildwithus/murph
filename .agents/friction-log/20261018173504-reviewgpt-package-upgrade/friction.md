---
title: 'ReviewGPT package-upgrade review omits repo-tools implementation source'
severity: 'minor'
---

## Expected Behavior

A guarded PR review snapshot for a repo-tools upgrade includes the exact locked dependency implementation and baseline source needed to inspect the behavior change and the carried patch.

## Current Behavior

The dependency context helper selects only ReviewGPT patches. A repo-tools upgrade includes manifest, lockfile, wrapper and committer patch changes, but omits the package implementation, leaving the reviewer unable to inspect the actual plan-closure correction.

## Minimal Reproducible Example

Prepare an isolated PR that upgrades the locked repo-tools package and renames its versioned patch. Build the canonical guarded review archive. Inspect the dependency context: neither the current repo-tools source nor the baseline implementation is included.

## Context

The same PR corrects the existing dependency-context owner to include integrity-verified current and baseline repo-tools source. The fixed registry, committed lockfile and patch authority, privacy checks and archive limits remain required.

---
title: 'Lockfile-only install re-resolves unrelated optional peers'
severity: 'minor'
---

## Expected Behavior

Adding a root importer for a version already present in the committed lockfile should change only that importer.

## Current Behavior

Running the documented lockfile-only install rewrites many unrelated optional peer snapshots, including versions outside the requested dependency change. A minimal dependency fix therefore requires discarding broad generated churn and adding the importer record manually.

## Possible Solution

Provide a repository-owned command for adding an existing locked package to one importer without re-resolving unrelated peers, or make the lockfile update deterministic against the committed graph.

## Minimal Reproducible Example

Add an existing pinned workspace dependency to the root manifest, then run `pnpm install --lockfile-only --ignore-scripts` and inspect the resulting lockfile diff.

## Context

This occurred while declaring an existing PostgreSQL client for a trusted CI controller. Accepting the generated churn would have broadened a four-line dependency fix into unrelated package resolution changes.

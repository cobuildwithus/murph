---
title: 'Frog reconciliation pull requests omit required change-shape evidence'
severity: 'minor'
issue: 'cobuildwithus/murph#4073'
---

## Expected Behavior

Every generated reconciliation pull request should satisfy the current PR evidence contract, including added and deleted line counts for its complete diff. Repeated reconciliation should preserve valid evidence without manual editing.

## Current Behavior

The workflow-owned footer omits the change-shape section. A later successful reconciliation reconstructs the body and removes any manually supplied breakdown, even when its diff tree is unchanged.

## Minimal Reproducible Example

Render the configured reconciliation footer through the existing PR context normalizer and inspect its headings. The required change-shape breakdown is absent.

## Context

Derive the summary from the complete metadata-only PR file inventory and validate its totals against PR metadata. Keep existing author and repository selection, permissions, and dependency versions unchanged.

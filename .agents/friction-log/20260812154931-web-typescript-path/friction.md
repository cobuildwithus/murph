---
title: 'Web TypeScript path overrides hide new workspace public subpaths on clean runners'
severity: 'minor'
---

## Expected Behavior

A workspace package public subpath added to its package manifest and covered by the root wildcard source mapping should typecheck consistently in local and clean-runner Web verification.

## Current Behavior

The Web TypeScript configuration replaces the inherited path map with an explicit list. A newly exported workspace subpath therefore resolved locally only while compiled package artifacts were present, but clean-runner Web verification could not resolve it. The package-boundary allowlist also required a separate manual update.

## Possible Solution

Add a repository check that compares workspace package exports used by Web with its source-path mappings and the package-boundary allowlist, or generate those declarations from one reviewed source.

## Minimal Reproducible Example

1. Add a narrow public subpath to a workspace package manifest and source tree.
2. Import it from the Web app without adding the matching Web path entry.
3. Run Web typechecking after package build artifacts exist; it may pass.
4. Remove build artifacts and run the same verification in a clean checkout; module resolution fails.

## Context

This produced false local confidence and delayed exact-head pull-request verification for a runtime-boundary correction.

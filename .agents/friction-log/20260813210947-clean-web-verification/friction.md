---
title: 'Clean Web verification can resolve a new package subpath only from stale dist'
severity: 'minor'
---

## Expected Behavior

Adding a public workspace package subpath used by Web should either be resolved from source by the same canonical workspace alias owner or fail the focused local Web typecheck before CI.

## Current Behavior

Web maintains a second explicit package-subpath alias list. A focused local typecheck can pass when the new package dist already exists, while clean release verification cannot resolve the same public subpath because the Web alias was omitted.

## Possible Solution

Generate or validate Web's explicit public-subpath aliases from package exports, and run the focused verifier without allowing pre-existing package dist artifacts to mask missing source resolution.

## Minimal Reproducible Example

1. Add a public export for a new workspace package source file.
2. Import that subpath from Web without adding it to Web's explicit path aliases.
3. Build the package locally, then run the Web typecheck and observe success.
4. Run clean release app verification and observe that TypeScript cannot resolve the subpath.

## Context

The mismatch delayed a device-sync safety change after all focused local typechecks were green and required a CI-only remediation commit.

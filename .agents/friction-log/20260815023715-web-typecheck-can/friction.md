---
title: 'Web typecheck can resolve new workspace subpaths from stale package builds'
severity: 'minor'
---

## Expected Behavior

Adding a public workspace-package subpath used by the web app should either typecheck from source in a clean checkout or fail the focused local check that owns the web TypeScript contract.

## Current Behavior

A prior package build leaves generated declarations that let the focused web typecheck resolve the new subpath even when the app-specific source path mapping is missing. Clean CI has no generated package output and fails later, so local and clean-runner results disagree.

## Possible Solution

Make the focused web typecheck ignore generated workspace-package output, or add a guard that keeps app-specific source mappings aligned with imported public package subpaths.

## Minimal Reproducible Example

1. Build a workspace package so its generated output contains a new public subpath.
2. Import that subpath from the web app without adding the matching web source mapping.
3. Run the focused web typecheck and observe success.
4. Move the generated package output aside and rerun the same check; resolution now fails.

## Context

This delayed a pull-request verification cycle and made a missing source-resolution contract appear locally valid.

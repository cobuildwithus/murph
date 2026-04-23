---
description: One-pass seam audit prompt for @murphai/runtime-state
---

# `@murphai/runtime-state`

## Scope

- `packages/runtime-state/src/**`
- `packages/runtime-state/README.md`
- directly coupled `packages/runtime-state/test/**`

## Focus

- `.runtime` taxonomy and portable vs machine-local placement
- hosted snapshot inclusion/exclusion and local secret containment
- JSON/SQLite versioning seams and descriptor-manifest drift across subsystems

## Prompt

Review the `@murphai/runtime-state` seam using the scope above. Focus on trust-boundary mistakes around portable vs machine-local state, snapshot-inclusion bugs, versioning or migration holes, path-resolution errors, and any way user-facing product truth could leak into operational residue. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that make runtime-state classification and snapshot policy easier to audit. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

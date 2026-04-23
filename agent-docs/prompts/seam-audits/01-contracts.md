---
description: One-pass seam audit prompt for @murphai/contracts
---

# `@murphai/contracts`

## Scope

- `packages/contracts/src/**`
- `packages/contracts/generated/**`
- `packages/contracts/test/**`
- `docs/contracts/00-invariants.md`
- `docs/contracts/01-vault-layout.md`
- `docs/contracts/03-command-surface.md`

## Focus

- canonical ownership of persisted record shapes, shared vocab, and command capability metadata
- schema/parser drift between code, frozen docs, examples, and generated schema artifacts
- vault-family/layout uniqueness and downstream root-barrel alignment
- compatibility shims or duplicate contract owners that should be removed instead of copied again

## Prompt

Review the `@murphai/contracts` seam in this repo using the scope above. Focus on concrete schema or parser bugs, invariant drift between code and frozen docs, cross-package compatibility hazards, and any trust-boundary assumptions encoded inconsistently across helpers, examples, or generated schemas. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that remove duplicate contract ownership or stale compatibility layers. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

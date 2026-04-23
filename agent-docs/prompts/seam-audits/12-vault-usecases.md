---
description: One-pass seam audit prompt for @murphai/vault-usecases
---

# `@murphai/vault-usecases`

## Scope

- `packages/vault-usecases/src/**`
- `packages/vault-usecases/README.md`
- directly coupled `packages/vault-usecases/test/**`

## Focus

- CLI/usecase orchestration without becoming a second owner of query or core models
- runtime loading shims, query-runtime compatibility views, and explicit usecase boundaries
- public barrels and service facades staying behavior-oriented rather than re-owning persistence semantics
- duplicated normalization or persistence logic that should live in lower owners

## Prompt

Review the `@murphai/vault-usecases` seam using the scope above. Focus on concrete bugs in runtime loading, adapter wiring, and usecase orchestration, especially any path where this layer silently becomes a second owner of query models, write behavior, or health-family contracts. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep this package a thin composition layer instead of a parallel domain owner. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

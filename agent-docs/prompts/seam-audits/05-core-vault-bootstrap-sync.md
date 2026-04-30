---
description: One-pass seam audit prompt for core vault bootstrap and metadata
---

# `@murphai/core` Vault Bootstrap And Metadata

## Scope

- `packages/core/src/vault.ts`
- `packages/core/src/vault-metadata.ts`
- `packages/core/src/vault-core-document.ts`
- `packages/core/src/domains/vault-summary.ts`
- `packages/core/src/path-safety.ts`
- `packages/contracts/src/{vault.ts,vault-families.ts}`
- directly coupled `packages/core/test/**`

## Focus

- bootstrap and `formatVersion` fail-closed behavior
- accidental leakage of local-only or non-authoritative state into canonical vault data

## Prompt

Review the `@murphai/core` vault bootstrap and metadata seam using the scope above. Focus on format-version or bootstrap regressions and any path that could accidentally treat projection or operational state as canonical truth. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep bootstrap and metadata responsibilities sharply separated. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

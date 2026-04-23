---
description: One-pass seam audit prompt for core vault bootstrap, metadata, sync, and shares
---

# `@murphai/core` Vault Bootstrap, Metadata, Sync, And Shares

## Scope

- `packages/core/src/vault.ts`
- `packages/core/src/vault-metadata.ts`
- `packages/core/src/vault-core-document.ts`
- `packages/core/src/domains/vault-summary.ts`
- `packages/core/src/vault-sync.ts`
- `packages/core/src/shares.ts`
- `packages/core/src/path-safety.ts`
- `packages/contracts/src/{vault.ts,vault-families.ts,shares.ts}`
- directly coupled `packages/core/test/**`

## Focus

- bootstrap and `formatVersion` fail-closed behavior
- additive vault-sync import semantics, conflict handling, and canonical-only pack shaping
- share payload boundaries and accidental leakage of local-only or non-authoritative state

## Prompt

Review the `@murphai/core` vault bootstrap, metadata, sync, and share seam using the scope above. Focus on format-version or bootstrap regressions, additive-sync bugs that could clobber authoritative data, share-boundary mistakes, and any path that could accidentally treat projection or operational state as canonical truth. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep bootstrap, sync, and share responsibilities sharply separated. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

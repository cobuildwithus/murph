---
description: One-pass seam audit prompt for core bank docs, memory, and preferences ownership
---

# `@murphai/core` Bank Docs, Memory, And Preferences

## Scope

- `packages/core/src/bank/**`
- `packages/core/src/memory.ts`
- `packages/core/src/preferences.ts`
- `packages/core/src/markdown-documents.ts`
- `packages/core/src/registry/**`
- `packages/core/src/public-mutations.ts`
- `packages/contracts/src/{bank-entities.ts,memory.ts,preferences.ts}`
- directly coupled `packages/core/test/**`

## Focus

- canonical document ownership for bank pages, memory, and preferences
- singleton document seams staying narrow instead of widening into profile sprawl
- write/read shape drift between core and upper-layer adapters
- accidental profile sprawl, duplicate type ownership, or leaky document-shape assumptions

## Prompt

Review the canonical bank-document, memory, and preferences ownership seam in `@murphai/core` using the scope above. Focus on concrete bugs in document addressing or serialization, duplicate ownership of persisted shapes, accidental widening of narrow preference documents, and any invariant drift between canonical docs and higher-layer adapters. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep these records small, explicit, and owned in one place. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

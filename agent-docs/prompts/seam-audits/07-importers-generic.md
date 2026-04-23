---
description: One-pass seam audit prompt for generic @murphai/importers normalization
---

# `@murphai/importers` Generic Normalization

## Scope

- `packages/importers/src/**`
- `packages/importers/README.md`
- directly coupled `packages/importers/test/**`

## Focus

- importer normalization for documents, meals, samples, and shared entrypoints
- strict delegation to core for canonical writes
- raw/source evidence preservation without over-promoting speculative structure

## Prompt

Review the generic `@murphai/importers` normalization seam using the scope above. Focus on direct-write boundary breaks, metadata normalization bugs, source-evidence loss, malformed payload preparation, and any regression where importer helpers start owning canonical behavior that should stay in core. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep importers thin, normalization-only adapters. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

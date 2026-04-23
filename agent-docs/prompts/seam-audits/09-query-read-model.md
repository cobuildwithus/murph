---
description: One-pass seam audit prompt for the main @murphai/query read-model seam
---

# `@murphai/query` Read Model, Search, Timeline, And Export

## Scope

- `packages/query/src/{index.ts,model.ts,read-model.ts,vault-reader.ts,query-projection.ts,query-projection-types.ts,search.ts,search-shared.ts,timeline.ts,export-pack.ts,export-pack-health.ts,overview.ts,canonical-entities.ts,vault-source.ts}`
- directly coupled `packages/query/test/**`

## Focus

- read-only guarantees over canonical vault state
- rebuildable projection correctness for search, timeline, and export views
- search-safe vs full-search surfaces and upper-layer model drift
- duplicate query-model ownership or leaky CLI/usecase assumptions

## Prompt

Review the main `@murphai/query` read-model seam using the scope above. Focus on concrete bugs in projection rebuildability, stale or lossy search/timeline materialization, accidental write-side behavior, and export/read-model drift that could misrepresent canonical records. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep one clear owner for query entities, projection state, and read helpers. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

---
description: One-pass seam audit prompt for @murphai/query knowledge contracts and search
---

# `@murphai/query` Knowledge Contracts And Search

## Scope

- `packages/query/src/{knowledge-contracts.ts,knowledge-format.ts,knowledge-graph.ts,knowledge-model.ts,knowledge-search.ts,health-library.ts,index.ts}`
- directly coupled `packages/query/test/**`

## Focus

- query-owned knowledge result contracts and graph/search behavior
- stable boundary between `bank/library/**` reference material and `derived/knowledge/**` synthesis
- graph/search behavior on malformed or incomplete pages
- duplicate ownership or adapter drift in assistant/CLI consumers

## Prompt

Review the `@murphai/query` knowledge seam using the scope above. Focus on concrete bugs in result contracts, graph/search behavior, library-vs-derived boundary handling, and any drift that could leave assistant or CLI layers depending on the wrong owner for shared knowledge shapes. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep the knowledge contract owner singular and explicit. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

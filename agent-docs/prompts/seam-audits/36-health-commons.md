---
description: One-pass seam audit prompt for @murphai/health-commons
---

# `@murphai/health-commons`

## Scope

- `packages/health-commons/src/**`
- `packages/health-commons/content/**`
- `packages/health-commons/generated/**`
- `packages/health-commons/scripts/**`
- `packages/health-commons/README.md`
- `agent-docs/product-specs/health-commons.md`
- `apps/web/src/lib/health-commons/**`
- directly coupled `packages/health-commons/test/**`

## Focus

- typed wiki-page model, protocol revisioning, generated catalog determinism, and artifact manifests
- public knowledge vs private run/outcome boundaries
- rights gating, artifact storage rules, duplicate recipe-hash handling, and generated-summary behavior that must not rewrite literature truth

## Prompt

Review the `@murphai/health-commons` seam using the scope above. Focus on concrete bugs in page typing, revision/hash semantics, generated catalog determinism, artifact manifest handling, public/private boundary mistakes, and any path where community summaries could silently rewrite source-backed claims. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep the Commons forkable, typed, and clearly separated from private run state. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

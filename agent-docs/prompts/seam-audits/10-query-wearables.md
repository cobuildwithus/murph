---
description: One-pass seam audit prompt for the @murphai/query wearables read model
---

# `@murphai/query` Wearables Read Model

## Scope

- `packages/query/src/wearables/**`
- `packages/query/src/wearables.ts`
- `packages/importers/src/device-providers/{metric-catalog.ts,provider-descriptors.ts}`
- directly coupled `packages/query/test/**`

## Focus

- dedupe, source selection, confidence, and semantic day-summary behavior
- tombstones plus overlapping provider evidence and deletion/repair paths
- read-model logic that may have absorbed policy better owned in shared metadata

## Prompt

Review the wearables read-model seam in `@murphai/query` using the scope above. Focus on concrete bugs in dedupe and source selection, confidence labeling, day-summary projection, tombstone handling, and any edge case where overlapping provider evidence could produce misleading or unstable derived output. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that reduce hidden policy duplication across wearable readers. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

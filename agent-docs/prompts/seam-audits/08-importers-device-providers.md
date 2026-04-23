---
description: One-pass seam audit prompt for device-provider adapters in @murphai/importers
---

# `@murphai/importers` Device-Provider Adapters

## Scope

- `packages/importers/src/device-providers/**`
- `packages/importers/README.md`
- `docs/device-provider-contribution-kit.md`
- directly coupled `packages/importers/test/**`

## Focus

- descriptor/adapter alignment for supported device providers
- snapshot preservation, deletion semantics, and source-priority hints
- duplicate provider metadata or normalization logic that should have one owner

## Prompt

Review the device-provider adapter seam in `@murphai/importers` using the scope above. Focus on concrete bugs in provider-descriptor alignment, snapshot-section preservation, deletion handling, source-priority policy, and any mismatch between adapter assumptions and the shared provider metadata. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that remove duplicated provider semantics or hidden adapter-specific policy. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

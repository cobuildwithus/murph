---
description: One-pass seam audit prompt for the @murphai/core staged write protocol
---

# `@murphai/core` Write-Batch Protocol

## Scope

- `packages/core/src/operations/write-batch.ts`
- `packages/core/src/operations/canonical-resource-lock.ts`
- `packages/core/src/operations/canonical-write-lock.ts`
- `packages/core/src/operations/raw-manifests.ts`
- `packages/core/src/raw.ts`
- `packages/core/src/write-policy.ts`
- `packages/core/src/path-safety.ts`
- `packages/runtime-state/src/write-operation-local-state-descriptors.ts`
- directly coupled `packages/core/test/**`

## Focus

- staged canonical write lifecycle, lock ordering, and recoverability after partial failure
- protected canonical paths, append-only targets, and raw-manifest consistency
- staged payload and receipt behavior staying aligned with runtime-state portability rules
- duplication or control-flow complexity that makes the write protocol harder to audit safely

## Prompt

Review the staged canonical write protocol in `@murphai/core` using the scope above. Focus on data-loss or partial-commit bugs, lock or concurrency mistakes, protected-path bypasses, receipt/recovery holes, and any failure mode that could corrupt canonical or raw state. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that make the write state machine easier to reason about without weakening invariants. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

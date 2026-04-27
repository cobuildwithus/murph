---
description: One-pass seam audit prompt for @murphai/assistant-runtime
---

# `@murphai/assistant-runtime`

## Scope

- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/**/*.ts`
- `packages/assistant-runtime/src/{hosted-email.ts,hosted-device-sync-runtime.ts}`
- `packages/assistant-runtime/README.md`
- directly coupled `packages/assistant-runtime/test/**`

## Focus

- hosted runtime execution/context/platform abstractions and child-launch seams
- mailbox import, workspace checkpointing, local outbox draining, issue export, usage export, and callback behavior after checkpoint
- app-topology leakage that should stay in app-local hosted layers instead of this package

## Prompt

Review the `@murphai/assistant-runtime` seam using the scope above. Focus on concrete bugs in hosted mailbox import, capture-scoped `conversation.message` ingestion, in-process local maintenance, checkpoint-before-outbox behavior, issue or usage export, and child-launch environment construction. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep runtime semantics shared while transport and deployment policy stay app-local. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

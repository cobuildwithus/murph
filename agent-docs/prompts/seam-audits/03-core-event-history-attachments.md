---
description: One-pass seam audit prompt for the @murphai/core event/history/raw-attachment pipeline
---

# `@murphai/core` Event, History, And Attachment Pipeline

## Scope

- `packages/core/src/domains/events.ts`
- `packages/core/src/history/**`
- `packages/core/src/event-attachments.ts`
- `packages/core/src/event-links.ts`
- `packages/core/src/raw.ts`
- directly coupled `packages/core/test/**`

## Focus

- event-spine integrity, revision/update behavior, and `ledger/events/**` semantics
- raw immutability, manifest linkage, and attachment staging correctness
- workflow façades that may have drifted into owning persistence details they should delegate

## Prompt

Review the `@murphai/core` event, history, and raw-attachment pipeline using the scope above. Focus on concrete bugs in event-envelope assembly, revision collapse, attachment/raw ownership, immutable artifact handling, and any regression that could orphan manifests or misbind events to raw evidence. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that reduce hidden coupling between workflow façades and primitive persistence seams. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

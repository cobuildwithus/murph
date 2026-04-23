---
description: One-pass seam audit prompt for inboxd capture persistence and runtime projection
---

# `@murphai/inboxd` Capture Persistence And Projection

## Scope

- `packages/inboxd/src/{contracts/**,indexing/**,kernel/**,runtime.ts,shared-runtime.ts,parsers.ts,connectors/**}`
- `packages/inboxd/README.md`
- directly coupled `packages/inboxd/test/**`

## Focus

- atomic raw persistence plus `ledger/inbox-captures` append behavior
- crash-recovery handling around unresolved `inbox_capture_persist` operations
- rebuildable projection/index state vs authoritative capture evidence
- trusted attachment copying and deterministic capture identity across rebuilds and retries

## Prompt

Review the `@murphai/inboxd` capture persistence and projection seam using the scope above. Focus on concrete bugs in atomic raw-plus-ledger persistence, crash recovery, dedupe, attachment-job state, and any path where local projection state could become the accidental source of truth for inbox captures or promotions. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep authoritative capture evidence and rebuildable runtime state sharply separated. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

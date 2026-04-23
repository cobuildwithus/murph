---
description: One-pass seam audit prompt for assistant-engine state, store, locks, and diagnostics
---

# `@murphai/assistant-engine` State, Store, Locks, And Diagnostics

## Scope

- `packages/assistant-engine/src/assistant/{state.ts,state-write-lock.ts,runtime-write-lock.ts,redaction.ts,state-secrets.ts,diagnostics.ts,issue-reporting.ts,failover.ts,receipts.ts,turns.ts,quarantine.ts}`
- `packages/assistant-engine/src/assistant/{state*.ts,store/**,store.ts,receipts.ts,diagnostics.ts,failover.ts,quarantine.ts,redaction.ts,issue-reporting.ts,runtime-write-lock.ts,state-write-lock.ts,state-secrets.ts,status.ts,service-usage.ts}`
- directly coupled `packages/assistant-engine/test/**`

## Focus

- assistant runtime residue, secret sidecars, and permission/redaction guarantees
- lock ordering, receipt/outbox consistency, and failover or replay safety
- diagnostics/issue export paths that could leak sensitive local or hosted data
- path safety and cross-vault isolation for persisted runtime artifacts

## Prompt

Review the assistant state/store/locks/diagnostics seam in `@murphai/assistant-engine` using the scope above. Focus on concrete bugs in secret handling, runtime-state permissions, lock ordering, receipt or replay consistency, and any logging or diagnostics path that could retain or export sensitive data unsafely. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that reduce hidden state coupling and make secrecy boundaries more explicit. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

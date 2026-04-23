---
description: One-pass seam audit prompt for @murphai/gateway-local
---

# `@murphai/gateway-local`

## Scope

- `packages/gateway-local/src/{local-service.ts,send.ts,store.ts,shared.ts}`
- `packages/gateway-local/src/store/{schema.ts,source-sync.ts,snapshot-state.ts,permissions.ts}`
- `packages/gateway-local/README.md`
- directly coupled `packages/gateway-local/test/**`

## Focus

- source-backed gateway projection store, snapshot state, and permissions
- local send/read wrappers over gateway-core contracts
- rebuildability and non-canonical status of gateway projection state
- sync signatures/cursors and local send idempotency or route-ownership checks

## Prompt

Review the `@murphai/gateway-local` seam using the scope above. Focus on concrete bugs in source-sync, projection rebuildability, permission state, send routing, and any path where the local gateway store could become a second durable authority instead of a derived runtime layer. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep source-backed projection logic and transport wrappers narrow and auditable. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

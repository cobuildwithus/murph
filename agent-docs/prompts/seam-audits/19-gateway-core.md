---
description: One-pass seam audit prompt for @murphai/gateway-core
---

# `@murphai/gateway-core`

## Scope

- `packages/gateway-core/src/{contracts.ts,opaque-ids.ts,routes.ts,reply-routes.ts,snapshot.ts,event-log.ts}`
- `packages/gateway-core/README.md`
- directly coupled `packages/gateway-core/test/**`

## Focus

- transport-neutral gateway contracts, opaque ids, and route vocabulary
- snapshot/event-log helpers that must stay runtime-agnostic and monotonic
- leakage of local or hosted execution policy into the shared contract owner

## Prompt

Review the `@murphai/gateway-core` seam using the scope above. Focus on concrete bugs in contract definitions, id helpers, route semantics, and snapshot/projection helpers, especially anything that could desync consumers or smuggle local/hosted policy into the transport-neutral layer. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep route vocabulary and core gateway contracts singular and explicit. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

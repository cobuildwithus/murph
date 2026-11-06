---
description: One-pass seam audit prompt for @murphai/gateway-core
---

# `@murphai/gateway-core`

## Scope

- `packages/gateway-core/src/{contracts.ts,reply-routes.ts,shared.ts}`
- `packages/gateway-core/README.md`
- directly coupled `packages/gateway-core/test/**`

## Focus

- transport-neutral reply-route inference and route vocabulary
- leakage of local or hosted execution policy into the shared contract owner

## Prompt

Review the `@murphai/gateway-core` seam using the scope above. Focus on concrete bugs in route vocabulary and reply-route inference, especially anything that could desync consumers or smuggle local/hosted policy into the transport-neutral layer. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep route vocabulary and shared route types singular and explicit. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

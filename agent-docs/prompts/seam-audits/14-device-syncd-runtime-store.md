---
description: One-pass seam audit prompt for the device-syncd local runtime and durable store
---

# `@murphai/device-syncd` Local Runtime And Store

## Scope

- `packages/device-syncd/src/{service.ts,store.ts,store/**,providers/**,webhook-verification.ts,crypto.ts,errors.ts,http.ts,metadata.ts,types.ts}`
- directly coupled focused provider runtime tests plus `packages/device-syncd/test/{store.test.ts,service.test.ts,shared-oauth.test.ts,webhook-traces.test.ts}`

## Focus

- encrypted token and OAuth-state handling in local durable state
- webhook verification, minimized traces, dedupe, reconcile jobs, and account-serialized execution
- disconnect-generation and lease fences preventing stale writes after disconnect or retry
- import delegation boundaries so provider runtimes do not own canonical writes

## Prompt

Review the local `@murphai/device-syncd` runtime and store seam using the scope above. Focus on concrete bugs in token/OAuth persistence, webhook verification or dedupe, reconcile-job serialization, disconnect-generation fencing, refresh-race handling, and any path where provider runtime code could bypass the importer-to-core write boundary. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that make secret handling and per-account job flow easier to audit. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

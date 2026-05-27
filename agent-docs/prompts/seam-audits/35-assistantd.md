---
description: One-pass seam audit prompt for @murphai/assistantd
---

# `@murphai/assistantd`

## Scope

- `packages/assistantd/src/{config.ts,http.ts,http-protocol.ts,service.ts,client.ts,bin.ts,index.ts}`
- `packages/assistantd/README.md`
- directly coupled `packages/assistantd/test/**`

## Focus

- loopback-only bearer-authenticated daemon control plane
- assistant route surface, recursion guards, request parsing/body limits, and vault binding per daemon
- accidental widening into canonical write authority or unsafe local exposure

## Prompt

Review the `@murphai/assistantd` seam using the scope above. Focus on concrete bugs in loopback/auth enforcement, route exposure, daemon client recursion guards, and any path that could widen the daemon into canonical write authority or expose another vault's runtime state. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep the daemon's trust boundary narrow and explicit. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

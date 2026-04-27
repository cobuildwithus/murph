---
description: One-pass seam audit prompt for apps/cloudflare runtime platform, outbound callbacks, and web-control client seam
---

# `apps/cloudflare` Runtime Platform, Callbacks, And Web-Control Client

## Scope

- `apps/cloudflare/src/{runtime-platform.ts,runner-outbound/**,web-control-plane.ts,web-callback-auth.ts,worker-contracts.ts,local-internal-proxy-route.ts}`
- directly coupled `apps/cloudflare/test/**`

## Focus

- injected hosted runtime platform capabilities and outbound callback/auth behavior
- mailbox/workspace/log callbacks, outbox delivery resume, callback signing/proxy assumptions, and internal host allowlists
- platform leakage that could couple shared runtime logic back to worker topology too tightly

## Prompt

Review the runtime-platform and callback seam in `apps/cloudflare` using the scope above. Focus on concrete bugs in outbound web-control calls, callback auth/signing, mailbox/workspace/log callbacks, post-checkpoint outbox delivery receipt handling, and any trust-boundary mismatch between injected platform capabilities and worker-local transport details. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep runtime platform semantics explicit and transport-specific glue small. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

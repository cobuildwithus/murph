---
description: One-pass seam audit prompt for the apps/cloudflare runner container and direct-runtime seam
---

# `apps/cloudflare` Runner Container And Direct Runtime

## Scope

- `apps/cloudflare/src/{runner-container.ts,container-entrypoint.ts,hosted-workspace-invocation.ts,runner-env.ts,runner-secrets.ts,hosted-env-policy.ts}`
- `packages/assistant-runtime/src/hosted-runtime/environment.ts`
- directly coupled `apps/cloudflare/test/**`

## Focus

- direct runtime env/secret filtering, invocation-local writable root handling, and local internal-proxy bridging
- supervisor vs runtime authority boundaries, abort handling, and post-invocation process-residue cleanup
- secret forwarding or container-bridge behavior that could overexpose runtime authority

## Prompt

Review the runner container and direct-runtime seam in `apps/cloudflare` using the scope above. Focus on concrete bugs in direct invocation lifecycle, env and secret filtering, loopback/proxy handling, abort and timeout cleanup, and any trust-boundary mistake that could leak supervisor authority or stale warm-container state into a user run. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that make runner lifecycle and env handling easier to inspect. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

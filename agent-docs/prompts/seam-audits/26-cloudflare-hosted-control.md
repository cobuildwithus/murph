---
description: One-pass seam audit prompt for @murphai/cloudflare-hosted-control
---

# `@murphai/cloudflare-hosted-control`

## Scope

- `packages/cloudflare-hosted-control/src/{client.ts,routes.ts}`
- `packages/cloudflare-hosted-control/README.md`
- directly coupled `packages/cloudflare-hosted-control/test/**`

## Focus

- private Cloudflare-owned control routes shared between hosted web and worker code
- route-shape, user binding, and browser-vault response parsing drift across the private seam
- accidental widening of this private seam into public or generic hosted-execution ownership

## Prompt

Review the private `@murphai/cloudflare-hosted-control` seam using the scope above. Focus on concrete bugs in route shapes, client expectations, authorization assumptions, and any drift between web and worker callers that could break internal control flow or weaken the intended private boundary. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep this seam small, private, and clearly distinct from `@murphai/hosted-execution`. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

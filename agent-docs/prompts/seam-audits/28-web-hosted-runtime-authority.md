---
description: One-pass seam audit prompt for apps/web hosted runtime authority
---

# `apps/web` Hosted Runtime Authority

## Scope

- `apps/web/src/lib/{hosted-mailbox/**,hosted-workspace/**,hosted-runner/**,hosted-execution/**}`
- `apps/web/prisma/schema.prisma`
- `apps/web/app/api/internal/{hosted-mailbox/**,hosted-workspace/**,hosted-runtime/**,hosted-execution/**}`
- directly coupled `apps/web/test/**`

## Focus

- web-owned mailbox ordering, per-lane sequence allocation, encrypted payload handling, and dedupe semantics
- hosted workspace checkpoint CAS, redacted status/log projection, and mailbox lag reporting
- authority mistakes that could let Cloudflare or private runtime state become durable product truth

## Prompt

Review the hosted runtime authority seam in `apps/web` using the scope above. Focus on concrete bugs in mailbox append/order/dedupe behavior, workspace checkpoint fencing, redacted status/log reporting, side-input payload ownership, and any path that weakens web ownership of durable hosted control-plane truth. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep web as a small mailbox/workspace control plane rather than a second runtime. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

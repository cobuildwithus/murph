---
description: One-pass seam audit prompt for apps/web hosted execution authority
---

# `apps/web` Hosted Run Authority

## Scope

- `apps/web/src/lib/{hosted-execution/**,hosted-run/**,hosted-ingress/**}`
- `apps/web/prisma/schema.prisma`
- `apps/web/app/api/internal/hosted-run/**`
- directly coupled `apps/web/test/**`

## Focus

- web-owned external ingress ordering, `HostedExecutionCursor`, and `HostedRun` recovery state
- acquire/commit/finalize/log flow, high-water fencing, and stale-run recovery
- run authority mistakes that could let Cloudflare or private runtime state become durable truth

## Prompt

Review the hosted execution authority seam in `apps/web` using the scope above. Focus on concrete bugs in external ingress ordering, cursor high-water fencing, run acquire/commit/finalize behavior, resume/retry safety, and any path that weakens web ownership of durable hosted execution truth. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that make run ownership, finalize recovery, and ingress ordering easier to audit. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

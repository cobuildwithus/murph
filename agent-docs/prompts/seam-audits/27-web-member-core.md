---
description: One-pass seam audit prompt for apps/web hosted member identity, routing, billing, and onboarding ownership
---

# `apps/web` Hosted Member Core

## Scope

- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/app/api/hosted-onboarding/**`
- `apps/web/app/api/settings/{email,phone,telegram,billing}/**`
- `apps/web/app/join/**`
- `apps/web/prisma/schema.prisma`
- directly coupled `apps/web/test/**`

## Focus

- hosted member identity, routing, billing, email authorization, and onboarding state ownership
- recoverable private-field handling, contact privacy, user-auth/session assumptions, and slice consistency
- accidental bleed of execution, vault, or provider raw-data ownership into hosted member records

## Prompt

Review the hosted member core seam in `apps/web` using the scope above. Focus on concrete bugs in identity/routing/billing ownership, cross-slice consistency, onboarding state transitions, private-field handling, contact privacy, and any authorization assumption that could let the wrong user or route control hosted member state. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep member core slices narrow and distinct from execution or vault authority. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

---
description: One-pass seam audit prompt for apps/web device-sync and messaging ingress route layers
---

# `apps/web` Device-Sync And Messaging Ingress

## Scope

- `apps/web/src/lib/device-sync/**`
- `apps/web/src/lib/linq/{api,env}.ts`
- `apps/web/src/lib/hosted-onboarding/{linq*.ts,telegram.ts,webhook-provider-*.ts,webhook-service*.ts}`
- `apps/web/app/api/device-sync/**`
- `apps/web/app/api/settings/device-sync/**`
- `apps/web/app/api/internal/device-sync/**`
- `apps/web/app/api/hosted-onboarding/{linq,telegram}/webhook/**`
- directly coupled `apps/web/test/**`

## Focus

- hosted device-sync control-plane authority, browser assertions, and runtime wake handoff
- hosted-onboarding Linq/Telegram webhook routing, member routing, and sparse persistence
- cross-boundary mistakes between hosted control, provider ingress, and later execution handoff
- callback auth and observed-version fences for internal runtime apply paths

## Prompt

Review the hosted device-sync and messaging-ingress seam in `apps/web` using the scope above. Focus on concrete bugs in browser assertion auth, device-sync control-plane authority, hosted-onboarding webhook routing and binding, sparse persistence, and any mistake that could let provider ingress widen into vault or execution authority incorrectly. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep ingress, hosted control, and later runtime execution responsibilities sharply separated. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

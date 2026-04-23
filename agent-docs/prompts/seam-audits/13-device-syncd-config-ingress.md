---
description: One-pass seam audit prompt for device-syncd config, manifests, ingress, and hosted-runtime seams
---

# `@murphai/device-syncd` Config, Ingress, And Hosted Runtime

## Scope

- `packages/device-syncd/src/config/{provider-manifests.ts,provider-configs.ts,provider-factory.ts,provider-env.ts,provider-types.ts,serializable-provider-configs.ts,runtime-config.ts}`
- `packages/device-syncd/src/{public-ingress.ts,hosted-runtime.ts,hosted-hints.ts,registry.ts,client.ts,shared.ts,provider-label.ts}`
- `packages/device-syncd/README.md`
- `docs/device-sync-hosted-control-plane.md`
- directly coupled `packages/device-syncd/test/**`

## Focus

- shared provider-manifest ownership across local and hosted callers
- public-ingress callback/webhook behavior and hosted-runtime snapshot/apply contracts
- hosted-serializable config excluding provider-owned admin secrets and unsupported fields
- provider-specific config drift that should stay on provider-owned seams instead of generic ingress shapes

## Prompt

Review the `@murphai/device-syncd` config, public-ingress, and hosted-runtime seam using the scope above. Focus on concrete bugs in provider-manifest assembly, env parsing, callback/webhook routing, hosted runtime contract shaping, and any trust-boundary mistake that could widen generic ingress to carry provider-specific or secret-bearing behavior. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep one owner for provider metadata and one narrow owner for public ingress. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

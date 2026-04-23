---
description: One-pass seam audit prompt for @murphai/messaging-ingress
---

# `@murphai/messaging-ingress`

## Scope

- `packages/messaging-ingress/src/{linq-webhook.ts,telegram-webhook.ts,telegram-webhook-payload.ts,telegram-types.ts,internal.ts}`
- `packages/messaging-ingress/README.md`
- directly coupled `packages/messaging-ingress/test/**`

## Focus

- stateless webhook parsing and verification for Telegram and Linq
- target grammar, message extraction, and sparse allowlisted minimization
- signature and timestamp checks plus redaction of tokens, cookies, and local paths
- accidental bleed of hosted policy, persistence, or execution concerns into this package

## Prompt

Review the `@murphai/messaging-ingress` seam using the scope above. Focus on concrete bugs in webhook verification, target grammar, sparse payload minimization, and any privacy or trust-boundary mistake that could over-retain raw data or quietly assume hosted lookup/execution behavior. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep this package stateless and narrow. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

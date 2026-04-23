---
description: One-pass seam audit prompt for the Cloudflare hosted email integration surface
---

# `apps/cloudflare` Hosted Email Integration

## Scope

- `apps/cloudflare/src/{hosted-email.ts,hosted-email/**,web-control-plane-email-ingress.ts}`
- `packages/assistant-runtime/src/hosted-email.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/email.ts`
- `packages/hosted-execution/src/{hosted-email.ts,email-ingress.ts}`
- directly coupled `apps/cloudflare/test/**`

## Focus

- sender/addressing/routing rules, verified-owner binding, and reply-alias behavior
- raw message retention, cleanup, lifecycle backstops, and replay/idempotency handling
- authorization and callback boundaries between web control, worker ingress, and runtime delivery
- envelope/Header-From binding and public-sender privacy behavior

## Prompt

Review the Cloudflare hosted email integration surface in this repo using the scope above. Focus on concrete bugs or regressions, security, privacy, and trust-boundary risks, unsafe retention or cleanup paths, authorization or routing mistakes, replay/retry/failure holes, envelope/Header-From binding mistakes, and any sender-binding issue that could misroute or overexpose hosted email traffic. Return only evidence-backed findings from current code, prioritizing concrete risk findings and behavior-preserving simplification targets that clearly reduce ambiguity or maintenance cost without changing the user-visible email contract. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.

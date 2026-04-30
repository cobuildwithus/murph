# Hosted Auth Consent Cleanup

## Goal

Make hosted auth consent prompts non-duplicative by separating passive legal copy from the durable launch-consent gate.

Success criteria:

- Homepage/signup auth can require current launch consent after auth completion without also implying every passive legal notice is a consent gate.
- Login can still surface stale or missing launch consent after completion.
- Downstream contact linking remains free of launch-consent prompts.
- `/join` launch consent remains gated after verified/matched invite auth for now; detailed `/join` UX discussion is deferred.

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Do not change legal consent storage, document versions, or server API semantics.
- Do not move `/join` consent ahead of phone verification in this cleanup.

## Scope

- `apps/web/src/components/hosted-onboarding/hosted-auth-panel.tsx`
- `apps/web/src/components/hosted-onboarding/hosted-phone-auth-step-views.tsx`
- direct hosted auth/join tests as needed

## Verification Plan

- Focused hosted auth/phone/join tests where practical.
- `pnpm test:diff` or scoped app test/typecheck if the dirty checkout blocks diff-aware verification.
- Required frontend and security/privacy review passes before handoff.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01

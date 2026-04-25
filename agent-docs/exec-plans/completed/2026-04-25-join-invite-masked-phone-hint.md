# Join Invite Masked Phone Hint

## Goal

Stop `/join/[inviteCode]` from sending a full invite phone prefill to the browser and restore a masked-hint-first verification UI.

## Scope

- `apps/web/src/lib/hosted-onboarding/{types,invite-service}.ts`
- `apps/web/src/components/hosted-onboarding/{hosted-invite-phone-auth,hosted-phone-auth-step-views,join-invite-sections,join-invite-stage-panels}.tsx`
- Directly coupled hosted onboarding tests.

## Constraints

- Keep invite status unauthenticated and safe to share by URL.
- Do not use undocumented Privy SMS internals.
- Preserve the existing client-side Privy SMS verification flow for manual entry.
- Preserve unrelated active hosted auth work and dirty-tree edits.

## Implementation Notes

- Official Privy docs and the installed SDK expose SMS login through client SDK methods that require a phone number on the client.
- The generated REST OpenAPI and `@privy-io/node` surfaces do not expose a supported server-side passwordless SMS send/login endpoint.
- Therefore the supported fix is to remove raw phone prefill from invite status and show only the stored masked hint before manual number entry.

## Verification Plan

- Focused Vitest for invite status, join invite client, and hosted phone auth.
- `apps/web` typecheck/lint where feasible.
- Diff whitespace check.
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25

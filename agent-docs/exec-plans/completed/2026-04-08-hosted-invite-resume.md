# Fix hosted invite resume after checkout cancel

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Let a previously verified invite user resume from the invite after canceling Stripe checkout without re-entering their phone number.
- Keep the hosted invite status refresh aligned with an already-authenticated Privy client session so the join page does not fall back to anonymous verification unnecessarily.

## Success criteria

- Invite resend can reuse the canonical stored phone when the signup-only phone field has already been cleared.
- Authenticated invite-status refreshes use authenticated request headers instead of the anonymous-first optional path.
- Focused hosted-web tests cover the canonical-phone fallback and the authenticated refresh mode.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-onboarding/invite-service.ts`
  - `apps/web/src/lib/hosted-onboarding/hosted-member-identity-store.ts`
  - `apps/web/src/components/hosted-onboarding/invite-status-client.ts`
  - focused hosted-web tests for invite resend and invite-status refresh
- Out of scope:
  - new session systems or cookie-based redesign
  - broad hosted-auth component refactors
  - checkout, Stripe webhook, or billing-state changes

## Current state

- Invite resend currently depends only on `signupPhoneNumber`, which is cleared after successful Privy reconciliation.
- Invite-status refresh currently uses `auth: "optional"` even when the client already reports an authenticated Privy session.
- Those two behaviors together can push a canceled-checkout user back into manual phone entry even though the hosted member already has a verified phone on file.

## Plan

1. Extend the hosted member identity projection so invite resend can see the canonical stored phone.
2. Update invite resend to prefer the canonical stored phone and fall back to the signup phone only when needed.
3. Make invite-status refresh use required auth once the client is already authenticated.
4. Add focused tests for the canonical-phone resend path and the authenticated status-refresh mode.
5. Run hosted-web verification and a final review-only audit pass.

## Risks and mitigations

1. Risk: overlapping hosted-auth refactors in nearby files.
   Mitigation: stay out of `hosted-phone-auth*` files and keep the diff to service/client seams plus tests.
2. Risk: changing generic auth semantics more broadly than needed.
   Mitigation: scope the authenticated refresh change to invite-status refresh rather than changing all optional-auth callers.
3. Risk: exposing the stored phone to the browser.
   Mitigation: keep the phone entirely server-side and continue returning only the existing invite resend payload.

## Verification

- Required hosted-web verification:
  - `pnpm typecheck`
  - `pnpm test:coverage`
  - `pnpm --dir apps/web lint`
Completed: 2026-04-08

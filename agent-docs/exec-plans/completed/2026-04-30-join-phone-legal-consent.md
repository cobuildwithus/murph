# Gate hosted phone verification with launch legal consent

Status: completed
Created: 2026-04-30
Updated: 2026-04-30

## Goal

- After a hosted invite phone verification succeeds, keep the user on the
  join flow until current launch-required legal consent is recorded or already
  current, then continue to checkout/activation/active status.

## Success criteria

- Phone verification does not reveal hosted checkout before launch-required
  consent is current.
- Users with current launch consent skip the consent card and continue normally.
- Consent acceptance records `source: "join-invite-phone-verify"` through the
  existing legal consent API/component.
- Focused tests cover both missing-consent and already-current consent paths.

## Scope

- In scope: `/join/[inviteCode]` client onboarding flow, the verify-stage panel,
  and directly coupled tests.
- Out of scope: deleting the legacy active-stage consent branch, changing legal
  API semantics, changing checkout/Stripe webhook behavior, or redesigning the
  join page.

## Constraints

- Technical constraints: the legal consent APIs require authenticated hosted
  member context, so the card must appear after phone verification finalizes
  session state.
- Product/process constraints: preserve unrelated dirty checkout label/footer
  work in this checkout.

## Risks and mitigations

1. Risk: invite status polling advances the page before consent can be shown.
   Mitigation: pause polling while a post-verification consent completion is
   pending.
2. Risk: users who already consented get stuck on an empty card.
   Mitigation: advance when `HostedLegalConsentCard` reports no requirement.

## Tasks

1. Add pending post-verification consent state to `JoinInviteClient`.
2. Render the existing `HostedLegalConsentCard` in the verify panel when that
   pending state exists.
3. Add/adjust focused tests for post-phone-verification consent gating.
4. Run focused checks and required completion audits.

## Decisions

- Reuse `HostedLegalConsentCard` instead of creating a second consent UI.
- Treat `checkout`, `activating`, and `active` post-verification stages as
  gated; do not gate a returned `blocked` status.

## Verification

- Passed: `pnpm exec vitest run apps/web/test/join-invite-client.test.ts
  apps/web/test/hosted-onboarding-billing-checkout-route.test.ts
  apps/web/test/hosted-onboarding-routes.test.ts --config
  apps/web/vitest.config.ts --no-coverage`.
- Passed: scoped hosted-web ESLint for the touched route, components, and tests.
- Passed: `pnpm --dir apps/web typecheck`.
- Passed: scoped `git diff --check`.
- Passed browser preview smoke with mocked consent API for
  `/join/invite-code?preview=checkout` at 1440px and 390px: no horizontal
  overflow, consent CTA is disabled before checkbox selection, enabled after,
  and checkout CTAs stay hidden while consent is pending.
- `bash scripts/workspace-verify.sh test:diff ...` failed on unrelated active
  tree issues: footer Link lint in `site-footer.tsx`, stale vault-sync migration
  expectation, dashboard sidebar expectations, and layout footer copy
  expectation. The Next build portion completed.

## Audit

- Impeccable audit status: behavioral and responsive checks pass for the new
  consent gate.
- Residual UI debt: the reused `HostedLegalConsentCard` still carries
  hard-coded warm colors and a tiny shadow, which conflicts with the local
  flat-paper/token guidance. This was not changed during the audit pass.
Completed: 2026-04-30

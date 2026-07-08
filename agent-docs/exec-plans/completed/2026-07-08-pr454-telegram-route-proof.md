# PR 454 Telegram Route Proof

## Goal

Fix the accepted ReviewGPT finding for PR 454: a Telegram identity-only hosted
member binding must not be treated as an established direct Telegram route for
group-newsletter missing-email nudges or other executable member notifications.

## Scope

- Keep Telegram user identity and direct Telegram thread target distinct in the
  hosted member routing owner.
- Preserve established direct Telegram routes when an inbound Telegram thread is
  actually known.
- Add production-faithful coverage through the routing store seam so identity-only
  bindings cannot spend the once-ever newsletter nudge key.

## Files

- `apps/web/src/lib/hosted-onboarding/member-private-codecs.ts`
- `apps/web/src/lib/hosted-onboarding/messaging-state.ts`
- `apps/web/test/hosted-onboarding-member-store.test.ts`
- `apps/web/test/hosted-group-newsletter.test.ts`
- focused affected tests as needed

## Verification

- Focused hosted web Vitest for the routing/newsletter/member-channel surfaces.
- `pnpm typecheck`
- `git diff --check`
- PR ReviewGPT rerun after push.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07

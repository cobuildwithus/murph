# Settings: Connected-account card unification (phone + telegram)

Status: completed
Owner: Claude Code (interactive)
Date: 2026-04-27

## Problem

The hosted phone settings card (`apps/web/src/components/settings/hosted-phone-settings.tsx`) shows the user's full E.164 phone number plus a redundant "Status: Verified in Privy" column. The card is cramped inside the 3-column messaging grid on the settings page, uses raw `stone-*` Tailwind classes that bypass the Murph warm-palette tokens, and duplicates a `<dl>` layout that is repeated almost verbatim in `hosted-telegram-settings-sections.tsx`.

## Goal

- Mask the displayed phone number to the last four digits (no full number in UI).
- Drop the "Status / Verified in Privy" column (Privy linkage is implied by the card existing).
- Replace the bespoke `<dl>` pattern with a single reusable `ConnectedAccountCard` component used by both phone and telegram settings sections.
- Bring the surface onto the Murph design tokens (`bg-card`, `border-border`, `text-muted-foreground`, mono kicker, serif identity value).

## Scope

- New: `apps/web/src/components/settings/connected-account-card.tsx`
- Edit: `apps/web/src/components/settings/hosted-phone-settings.tsx`
- Edit: `apps/web/src/components/settings/hosted-telegram-settings-sections.tsx`
- Edit: `apps/web/src/components/settings/hosted-settings-utils.ts` (add `formatMaskedPhoneNumber`)
- Edit: `apps/web/src/components/settings/hosted-billing-settings.tsx` (warm token swap)
- Edit: `apps/web/src/components/settings/hosted-billing-settings-action.tsx` (move billing-portal error inline below the button, swap heavy `Alert` block for compact reserved-height destructive line, prevent layout jump)
- New: `apps/web/test/settings-connected-account-card.test.ts`

## Out of scope

- Email settings card (separate styling pass).
- Any auth/linking flow logic. Pure presentation.
- Telegram sync helpers and Privy account resolution.
- Pre-existing typecheck errors in `apps/web/src/components/hosted-onboarding/hosted-phone-auth-controller.ts` (owned by ledger row 144 / `2026-04-16-phone-wallet-refresh.md`, not introduced by this lane).

## Verification

- `pnpm --filter @murph/web typecheck`
- `pnpm --filter @murph/web test:diff <touched paths>` (or focused settings-page test if test:diff is not truthful)
- Visual readback: phone card shows `•••• 7706` with a single Change phone button; telegram card shows `@username` with Link/Save buttons.

## Notes

- Reuses existing shadcn `Button` and Murph design tokens; no new dependencies.
- Component lives under `components/settings/` (domain-scoped, not shared `ui/`) until a third caller emerges.
Updated: 2026-04-27
Completed: 2026-04-27

# Settings: empty-state card parity and layout-stable status notes

Status: completed
Owner: Claude Code (interactive)
Date: 2026-04-27

## Problem

Two regressions visible in the messaging row of `apps/web/(dashboard)/settings/page.tsx`:

1. The email column has no card surface in its unlinked/empty state — phone and telegram render their warm card with a kicker label, serif value, and inline action button, while email just shows a heading plus a "Link email" button. The columns no longer feel parallel.
2. The phone, telegram, and email wrapper components each render heavy `Alert`/banner blocks above the section heading whenever a status changes (success, error, in-progress). When an error appears the heading and card are pushed down by ~80–100 px, creating a large layout shift.

## Goal

- Render a `ConnectedAccountCard` for the unlinked state too, with a muted "Not connected" placeholder value, helper-line meta, and the Link/primary action inside the card. All three columns then look like the same surface whether linked or not.
- Replace the heavy success/error/in-progress `Alert` banners at the top of phone/telegram/email with a compact reserved-height inline status note anchored beneath the card. The section never shifts layout when the status changes.
- Keep all existing controller/onLink/onSync behavior intact — pure presentation.

## Scope

- Edit: `apps/web/src/components/settings/connected-account-card.tsx` (variant prop for `default` vs `empty`)
- Edit: `apps/web/src/components/settings/hosted-phone-settings.tsx`
- Edit: `apps/web/src/components/settings/hosted-email-settings.tsx`
- Edit: `apps/web/src/components/settings/hosted-email-settings-sections.tsx` (handle empty-state card; pending-code panel stays separate but warm-tokenized)
- New helper (optional): `SettingsStatusLine` — small component for the inline reserved-height status note. Inline single component if it stays narrow.
- Edit: `apps/web/test/settings-connected-account-card.test.ts` (cover empty-state variant + `SettingsStatusLine` reserved-height + destructive tone)

Telegram explicitly excluded: `hosted-telegram-settings.tsx` and `hosted-telegram-settings-sections.tsx` are owned by an active Codex coordination-ledger row removing the manual save-connection button. The same empty-state + status-line pattern will be applied to telegram in a follow-up after that lane lands.

## Out of scope

- Auth/linking/sync helpers and Privy account resolution.
- Verification dialog content.

## Verification

- `pnpm exec tsc -p apps/web/tsconfig.json --noEmit` for the touched paths.
- Re-run `apps/web/test/settings-email-settings.test.ts`, `apps/web/test/settings-page.test.ts`, `apps/web/test/settings-connected-account-card.test.ts`.
- Visual readback: `localhost:3000/design` 200; cannot browser-verify the live cards without auth in this session, so cover via static SSR test.
Updated: 2026-04-27
Completed: 2026-04-27

# Settings: Align email card with ConnectedAccountCard pattern

Status: completed
Owner: Claude Code (interactive)
Date: 2026-04-27

## Problem

`apps/web/src/components/settings/hosted-email-settings-sections.tsx` still uses raw `text-stone-*` tokens, ad-hoc layout, and folds the connected-email status into a description sentence ("Connected as user@example.com.") instead of the new `ConnectedAccountCard` surface that phone and telegram now use. The "Add an email so Murph can reach you there." subtext keeps showing even after the user is already linked. The email card needs to feel like the phone and telegram cards.

## Goal

- When an email is linked, render it inside `ConnectedAccountCard` (label, masked-or-full address, optional `(unverified)` meta, action buttons in the card slot).
- Hide the "Add an email so Murph..." subtext once already linked.
- Switch the heading + subtext to Murph design tokens (`font-serif`, `text-foreground`, `text-muted-foreground`).
- Keep all linking, code-send, code-verify, and dialog flows intact — pure presentation change.

## Scope

- Edit: `apps/web/src/components/settings/hosted-email-settings-sections.tsx`
- Edit: `apps/web/test/settings-email-settings.test.ts` (replace stale "Connected as ..." copy assertion with the new card-based assertion that the address still renders and the stale account is omitted)

## Out of scope

- `hosted-email-settings.tsx` shell (alerts) — leave as-is for this pass.
- `useHostedEmailSettingsController` and verification dialog logic — pure presentation only.

## Verification

- `pnpm exec tsc -p apps/web/tsconfig.json --noEmit`
- Run any existing focused settings tests that touch email rendering.
- Visual readback: `localhost:3000/design` 200, settings page redirects unauth as before.
Updated: 2026-04-27
Completed: 2026-04-27

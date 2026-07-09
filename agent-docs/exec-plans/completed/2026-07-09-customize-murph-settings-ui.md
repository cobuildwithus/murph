# Customize-Murph settings section and assistant style picker redesign

## Why

Will reviewed the assistant style picker dialogs and the settings entry points and asked for three things:

1. The voice step is cramped and busy: the dialog renders narrow (the `max-w-lg` override loses to the dialog primitive's `sm:max-w-sm`), voices stack one per row, and each card nests several bordered boxes. He wants a wider dialog with a three-column voice grid on desktop and two columns on mobile.
2. The Classic Murph description, "Murph's default voice from this workspace.", is jargon. Members do not know what a workspace is.
3. The tone step is also cluttered (a chat bubble nested inside a bordered card with a floating radio circle), and settings should get a dedicated "Customize your Murph" section that opens tone, voice, or contact-card customization individually, instead of burying tone/voice in the Messaging list and the contact card link under the Phone row.

## Scope

- `packages/contracts/src/preferences.ts` — replace the Classic Murph description with plain copy.
- `apps/web/src/components/murph/murph-assistant-style-picker.tsx` — widen the desktop dialog per step, redesign the tone chooser (single-surface option cards, side by side on desktop), redesign the voice chooser (2-col mobile / 3-col desktop grid, compact cards), and add a single-step mode so settings rows can open tone-only or voice-only.
- `apps/web/src/components/settings/` — extract `SettingsRow` for reuse, add `customize-murph-settings.tsx` owning the assistant-style and contact-card pickers plus the `?voice=true` deep link, and strip those from `hosted-account-settings-cards.tsx` (the "Text Murph" link stays on the Phone row).
- `apps/web/app/(dashboard)/settings/page.tsx` — new "Customize your Murph" section between Messaging and Wearables.
- Matching tests: `apps/web/test/murph-assistant-style-picker.test.tsx`, `apps/web/test/hosted-account-settings-cards.test.tsx`, new `apps/web/test/customize-murph-settings.test.tsx`.

## Invariants

- Onboarding (`initial-visit-dialog-client.tsx`) keeps the chained tone → voice flow unchanged.
- Voice filter stays display-only (never persisted); hidden-selection notice behavior stays.
- Contact-card customization stays gated on a Murph text line (`murphPhoneNumber`).
- The `?voice=true` deep link still opens the voice picker from settings and strips the query param.
- Tone options keep showing sample messages, not descriptions.

## Verification

- `pnpm typecheck` (apps/web) and `pnpm test:diff` over touched files.
- Browser check of the settings page and both picker steps at desktop and mobile widths.
Status: completed
Updated: 2026-07-09
Completed: 2026-07-09

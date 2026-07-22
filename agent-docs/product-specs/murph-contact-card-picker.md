# Murph Contact Card Picker

Last verified: 2026-07-22
Status: Implemented (picker on `/design?tab=components`, vCard route, signup-success placement, and initial-visit handoff); persisted avatar choice not started

## Why

Murph's contact card ships with one canonical headshot (the hooded character). Some new members like it; some find it off-putting. Right after signup we want every member to add Murph as a contact, so the add-to-contacts moment should let them pick the avatar they save. The choice is cosmetic only: one Murph, one voice, different picture on the card.

## User flow (implemented)

The contact-card picker remains available immediately after website signup:

1. The website signup success stage (`join-invite-stage-server.tsx`) renders `MurphAddToContactsButton`, which opens the picker. This replaced the old inline `data:` URI vCard that had no photo and no backup line.
2. `/home?initialVisit=true` resolves the member's contact channel. Members with a text contact see the contact-card picker first; adding the card, skipping, or dismissing advances to the Murph personality picker. Members without a text contact start directly at the personality picker. Saving the personality opens the final Welcome to Murph dialog with the resolved messaging action; skipping or dismissing the personality picker ends the handoff without it.

The signup and design-system surfaces reuse `MurphContactCardPicker` in `apps/web/src/components/murph/murph-contact-card-picker.tsx` (drawer under 768px, dialog above, via `useIsMobile`).

## Avatar options

Static list in `apps/web/src/lib/murph-contact-avatars.ts` (`MURPH_CONTACT_AVATAR_OPTIONS`), currently seven entries:

- Four character headshots from `apps/web/public/murph-headshots/` (hooded, classic, gremlin, referee), served as 320px `-sm` thumbnails. Uncropped source renders live in the Murph character sheet (`agent-docs/assets/murph-character-sheet-v1.png`); add more options by dropping a cropped square PNG in that directory and appending to the list.
- Two dot-grid logo marks: `logo-dark` (slate) and `logo-light` (cream), raster assets in `apps/web/public/brand-logos/murph-logo-avatar-{dark,light}.png`.
- No photo (sand circle with an M initial in the picker; the saved card simply has no `PHOTO` field).

Target range is five to ten options. Option ids are stable identifiers; never reuse an id for a different image once production wiring persists or links to them.

## Production wiring

- Implemented: "Add Murph to Contacts" is a download link to `GET /api/murph-contact-card?avatar=<id>` (`apps/web/app/api/murph-contact-card/route.ts`), which returns `Murph.vcf` built with the existing `buildMurphHostedLinqContactCardVcf` (`apps/web/src/lib/hosted-onboarding/linq-contact-card.ts`): the member's own line as the `mobile` number, a second healthy pool line under the `backup` label, and the chosen avatar embedded as `PHOTO` (fetched from the deployment's own public assets). `avatar=none` omits `PHOTO`; unknown ids fall back to the default headshot. The route requires an active hosted member session and resolves the member's line server-side from hosted member routing.
- Saving the vCard sets the contact photo in the member's own address book, which overrides what the Linq-side card would show. That is the entire per-user effect.
- Members without a phone line get a 409 (`MURPH_TEXT_LINE_NOT_READY`); signup surfaces should skip the picker for them and keep the current CTA-only welcome shape.

## Invariants and non-goals

- Do not write member avatar choices to Linq per-line contact cards. Lines are pooled across members and the contact-card cron (`reconcileHostedLinqContactCards`) keeps the provider card shared and name/phone-only; a per-member choice written there would fight the reconciler and leak one member's pick to others on the same line.
- Contact-card choices do not change assistant behavior. Tone and voice preferences are owned separately by `agent-docs/product-specs/murph-tone-and-voice.md`.
- v1 keeps no server state for the choice. Optional follow-up: persist the chosen avatar id on the hosted member so the group contact-card share tool and future re-sends use it.

## Current state

`MurphContactCardPicker`, `MurphContactAvatarGrid`, `MurphContactAvatarArt`, `MurphContactCardPreview`, and `MurphAddToContactsButton` are live on `/design?tab=components`, the signup success stage, and the initial-visit handoff for members with a text contact; the picker's primary CTA downloads the real vCard from `/api/murph-contact-card`. Remaining: the optional persisted avatar choice for group-share reuse.

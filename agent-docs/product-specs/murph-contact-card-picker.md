# Murph Contact Card Picker

Last verified: 2026-07-03
Status: Partially implemented (picker components on `/design?tab=components`; vCard download route live; signup-surface placement not started)

## Why

Murph's contact card ships with one canonical headshot (the hooded character). Some new members like it; some find it off-putting. Right after signup we want every member to add Murph as a contact, so the add-to-contacts moment should let them pick the avatar they save. The choice is cosmetic only: one Murph, one voice, different picture on the card.

## User flow

Right after signup, the member sees an add-Murph-to-contacts step:

1. Signup-oriented landing auth routes to `/home?initialVisit=true`, which opens the one-shot welcome dialog (`apps/web/app/(dashboard)/home/initial-visit-dialog-client.tsx`). The picker becomes that dialog's contact step, keeping the existing "Text Murph" / "Start exploring" actions reachable.
2. The website signup flow's success stage (join/invite) shows the same picker after the member finishes signup.

The step shows Murph's contact preview with a selectable avatar grid and a primary "Add Murph to Contacts" button. Exact copy and presentation are TBD; the non-negotiable is that adding Murph as a contact is the primary action right after signup, and the avatar grid rides along as the personalization.

Both surfaces reuse one component: `MurphContactCardPicker` in `apps/web/src/components/murph/murph-contact-card-picker.tsx` (drawer under 768px, dialog above, via `useIsMobile`).

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

- Do not touch Linq per-line contact cards. Lines are pooled across members and the contact-card cron (`reconcileHostedLinqContactCards`) reconciles every line to the canonical headshot; a per-member choice written there would fight the reconciler and leak one member's pick to others on the same line.
- No persona or behavior change. The assistant prompt, name, and voice are untouched; only the card image varies.
- v1 keeps no server state for the choice. Optional follow-up: persist the chosen avatar id on the hosted member so the group contact-card share tool and future re-sends use it.

## Current state

`MurphContactCardPicker`, `MurphContactAvatarGrid`, `MurphContactAvatarArt`, and `MurphContactCardPreview` are showcased under "Contact Card Picker" on `/design?tab=components`, and the picker's primary CTA downloads the real vCard from `/api/murph-contact-card`. Remaining: placing the picker in the `initialVisit` welcome dialog and the signup success stage, and the optional persisted avatar choice.

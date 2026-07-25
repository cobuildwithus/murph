# Murph Contact Card Picker

Last verified: 2026-07-25
Status: Implemented (picker on `/design?tab=components`, vCard route, signup-success placement, initial-visit handoff, and automatic delivered invite-signup thread share); persisted avatar choice not started

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

- Implemented: "Add Murph to Contacts" is a download link to `GET /api/murph-contact-card?avatar=<id>` (`apps/web/app/api/murph-contact-card/route.ts`), which returns `Murph.vcf` built with the existing `buildMurphHostedLinqContactCardVcf` (`apps/web/src/lib/hosted-onboarding/linq-contact-card.ts`): the member's own line as the `mobile` number, a second healthy pool line under the `backup` label, and the chosen avatar embedded as `PHOTO` (fetched from the deployment's own public assets). The optional backup comes from the existing `HostedLinqLine` projection maintained by scheduled provider reconciliation, so a download never performs live provider inventory or reconciliation work; a missing or unreadable projection omits only the backup. `avatar=none` omits `PHOTO`; unknown ids fall back to the default headshot. The route requires an active hosted member session and resolves the member's line server-side from hosted member routing.
- Saving the vCard sets the contact photo in the member's own address book. That is the entire per-user effect.
- When a live `message.delivered` receipt advances a correlated `invite_signup` or `invite_signup_fallback` delivery, the post-commit webhook path considers Linq's native `share_contact_card` endpoint for the receipt's chat (`shareMurphHostedLinqNativeContactCardToChat` in `apps/web/src/lib/hosted-onboarding/linq-contact-card-share.ts`). Before reserving or sharing, it resolves the chat's own sending line and fetches that line's provider contact card. The native share fires only when the card is verified image-free (`imageUrl === null`); an unreadable roster, unresolved line, missing card, provider read failure, or non-null image skips fail-soft. Provider acceptance and `message.sent` alone do not trigger the card. If the delivered receipt arrived before the accepted milestone established correlation, accepted-milestone replay schedules the same best-effort check after its transaction commits. Existing-chat direct and group signup replies are eligible, and the degraded-line fallback checks the newly created direct chat; non-iMessage services are skipped. The check and share never fail or delay reply delivery, and a verified image-free share uses the per-chat 90-second retry-window reservation shared with the explicit group `share_contact_card` tool so duplicate attempts within one turn/wake cannot double-send. This guard is a deliberately simple best-effort check, not an authoritative proof: because native `share_contact_card` is a bodyless POST, the preflight read cannot be atomically bound to the card Linq pushes, so an ambiguous roster carries a small residual risk. This is an explicit product decision favoring minimal complexity over authoritative correctness while a provider-enforced Linq fix is in progress and operators clear existing line-card images. Skipping an imaged or unverifiable line for a delivery is likewise a deliberate product decision, not a silent drop: the member still received the signup reply and can add Murph from the web picker, the skip is logged, and the automatic share resumes for future contacts once the image is removed.
- Automatic native first-contact sharing never pushes a provider card that could overwrite a member-selected photo. A sending line whose provider card still has an image is skipped without consuming the reservation until an operator removes that image through Linq; the next eligible first-contact share for that line verifies again and proceeds once the image is gone. The first-party `.vcf`, with the canonical or member-chosen photo, remains the mechanism for Murph's discretionary in-chat share through the group `share_contact_card` tool and for the web "Add to Contacts" picker download.
- Members without a phone line get a 409 (`MURPH_TEXT_LINE_NOT_READY`); signup surfaces should skip the picker for them and keep the current CTA-only welcome shape.

## Invariants and non-goals

- Do not write member avatar choices to Linq per-line contact cards. Lines are pooled across members, and the hourly contact-card reconcile (`reconcileHostedLinqContactCards`) only creates missing cards or corrects the shared Murph name; it does not clear an existing image because Linq's API cannot do so. Image removal is an operational action in Linq. The share-time guard self-heals without cron or repair state: every eligible native first-contact share reads the current line card, skips while an image remains, and can proceed on the next share after the image is removed. Member-selected photos stay confined to first-party `.vcf` generation.
- Contact-card choices do not change assistant behavior. Tone and voice preferences are owned separately by `agent-docs/product-specs/murph-tone-and-voice.md`.
- v1 keeps no server state for the choice. Optional follow-up: persist the chosen avatar id on the hosted member so the group contact-card share tool and future re-sends use it.

## Current state

`MurphContactCardPicker`, `MurphContactAvatarGrid`, `MurphContactAvatarArt`, `MurphContactCardPreview`, and `MurphAddToContactsButton` are live on `/design?tab=components`, the signup success stage, and the initial-visit handoff for members with a text contact; the picker's primary CTA downloads the real vCard from `/api/murph-contact-card`. Remaining: the optional persisted avatar choice for group-share reuse.

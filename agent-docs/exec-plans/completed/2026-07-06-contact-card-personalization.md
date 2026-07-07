# Contact Card Personalization: Stop Clobbering User-Chosen Murph Contacts

Status: completed
Owner: Claude (supervising), Codex (implementation)
Worktree: `murph-contact-card-personalization`, branch `feat/contact-card-personalization`

## Why

During onboarding, users pick a Murph character avatar and save Murph as a contact
from a generated `.vcf` (`/api/murph-contact-card?avatar=<id>`). Separately, the
hosted runtime pushes Linq's native iMessage contact card
(`POST chats/{chatId}/share_contact_card`) after outbound sends in direct iMessage
chats, throttled per chat per 48h, forever. The provider-side card is configured by
an hourly reconcile with `first_name: "Murph"` and a fixed default
`image_url` (`murph_headshot.png`).

On the recipient's iPhone the push shows the "shared a new name and photo" banner;
tapping Update overwrites the saved contact's name AND photo with the card values.
Real user impact observed: a user who saved the contact with her own casing and a
chosen character got her contact renamed, and anyone who picked a non-default
character gets it replaced by the default headshot if they accept. Because the
diff between the card and their saved contact persists, the 48h loop keeps
re-prompting them.

## Changes

1. **Stop pushing the native card at existing members.** Delete the hosted-runtime
   after-outbound share path (runtime callbacks queueing, effects-port method,
   route path constant usage). Keep the web route
   `/api/internal/hosted-runtime/linq/contact-card/share-after-outbound` as a
   temporary legacy no-op success so warm runner containers on the old bundle do
   not hit 404s during gradual rollout (see the 2026-07 consume-route deploy-skew
   incident); delete it in a follow-up once the runner fleet has converged. In
   `webhook-transport.ts`, share the card only on the first-contact signup path
   (cold, non-member inbound) and drop the share eligibility plumbing from the
   other side-effect templates (e.g. AI usage quota notices to existing members).
2. **Remove the image from the provider-side Linq card** so even the remaining
   first-contact share can never replace a chosen photo. The reconcile's desired
   card becomes name + phone only, and the reconcile must actually converge when
   the provider still has an image (clear explicitly if the API shape allows).
   The `.vcf` builder photo support (onboarding download route, group-chat
   `Murph.vcf` attachment) is unchanged.
3. **Settings: customize your Murph contact.** Add a row in the Settings
   Messaging section (phone members only) that opens the existing
   `MurphContactCardPicker` so existing users can pick a character and re-download
   the card. No new persisted state; the card download is the artifact.

## Invariants

- First-contact cold inbound still gets a contact-card share (name-only card) so
  unsaved contacts see "Murph" instead of a bare number.
- No 404s from stale runner containers during rollout (legacy no-op route).
- Onboarding and group `.vcf` flows keep their photos and behavior.
- No new durable state, queues, or lifecycle machinery.

## Verification

- `pnpm typecheck` plus `pnpm test:diff <touched paths>` from the repo root;
  focused owner tests for runtime callbacks, webhook transport, contact-card
  reconcile/share, and the settings surface.

## Deploy

Web-first (Vercel before Cloudflare). Old runner bundles keep POSTing the share
route during gradual rollout; the no-op route absorbs that safely. No immediate
container rollout required.
Updated: 2026-07-06
Completed: 2026-07-06

# Group contact-card re-share on request

## Problem

In a group chat, when someone explicitly asks Murph to resend its contact card
(for example a participant did not see the earlier card), Murph refuses and
invents a provider limitation ("the chat will not let me post a duplicate").
Real transcript: a member asked "resend your contact" twice and Murph refused
both times, forcing the member to forward the card manually.

Three stacked causes:

1. The group-chat skill instructed "Never try to re-send it", so the model
   refused requested re-shares outright.
2. The `murph.group` `share_contact_card` path throttles attempts per chat for
   48h via `reserveHostedLinqContactCardShareAttempt`, returning
   `already_shared` for any re-share inside two days. On current `main` the
   group tool is the only caller of that reservation seam, so the 48h cadence
   protects nothing else.
3. The provider idempotency key was `group-contact-card:<chatId>:<day>`, so
   even an allowed same-day re-share would be silently deduped by the
   provider.

## Fix

1. `apps/web/src/lib/hosted-onboarding/linq-contact-card-share.ts`
   - The shared throttle constant drops from 48h to 10 minutes. Every share is
     an intentional assistant tool decision; the window now only dedupes
     duplicate attempts within one turn/wake.
2. `apps/web/src/lib/hosted-groups/group-tool.ts`
   - The attachment idempotency key is scoped to the reservation instant
     (`reservation.attemptedAt.getTime()`), so retries of one reservation
     still dedupe at the provider while distinct reservations are distinct
     sends.
3. `packages/assistant-engine/skills/group-chat/SKILL.md` and
   `packages/assistant-engine/src/assistant/system-prompt.ts`
   - Both surfaces now say: do not re-send unprompted, but if someone asks to
     resend or re-share the card, share it again; `already_shared` means a
     send within the last few minutes, so say the card was just sent instead
     of claiming the chat blocks duplicates.
4. Focused tests updated: throttle-window test, idempotency-key assertion, and
   prompt/skill string assertions (including a regression assertion that
   "Never try to re-send it" stays gone).

## Invariants

- Authority, eligibility, and roster checks for the group share path are
  unchanged.
- The failed-send release path is unchanged.
- No new persisted state; the existing `hostedLinqContactCardShare` row and
  reservation seam are reused.

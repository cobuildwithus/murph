# Linq Family Invite Acceptance

## Goal

Make iMessage/Linq a production-ready Family invite acceptance path by handling
phone-bound `family_<invite>` tokens before the generic Linq first-contact
signup flow.

## Scope

- Extend hosted Linq webhook planning to accept phone-bound Family invite
  tokens from the inbound participant phone.
- Send the existing Family welcome reply in the same Linq chat after
  acceptance.
- Keep Telegram and WhatsApp behavior unchanged.
- Add focused hosted web tests for the Linq Family invite happy path and
  mismatch/non-family fallback behavior.

## Invariants

- Family invite acceptance must remain owner-issued, token-scoped, expiring,
  seat-checked, and bound to the invited phone when a phone lookup is present.
- Linq/iMessage must not create cold outbound chats for Family invites.
- A Family token must not fall through to the ordinary first-contact signup
  link path.
- Existing Linq first-contact signup behavior must remain unchanged for
  non-Family messages.

## Verification

- Run focused hosted web tests covering Linq Family invite acceptance.
- Run the narrowest truthful diff-aware verification available for the touched
  app files, or report any unrelated blocker.
Status: completed
Updated: 2026-06-26
Completed: 2026-06-26

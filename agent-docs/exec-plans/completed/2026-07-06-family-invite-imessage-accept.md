# Family invite iMessage/SMS accept + accept-page redesign

## Why

A family-plan invitee reachable only by phone/iMessage (no Telegram) landed on
the web accept page and was shown only "Continue in Telegram", pushing them into
an app they do not have and a Telegram verification they cannot pass. Root cause:
the accept page offered Telegram whenever a bot username was configured in env,
independent of how the invitee was actually reachable, and offered no
iMessage/SMS path even though the LinQ accept-by-phone webhook already exists.
The page was also a bare one-off, not built on the shared invite shell.

Utmost priority: clean, simple, long term maintainable and composable
architecture with minimal complexity.

## User-visible goal

- A phone-bound invitee accepts by texting Murph the family token from the phone
  they already use ("Continue in Messages"), with no Telegram and no separate
  verification step.
- Telegram is offered only when the invite is actually Telegram-bound.
- Email-bound invites keep the web sign-in path; authenticated invitees keep the
  one-tap web accept.
- The accept page is rebuilt on the shared branded invite shell.

## Approach (minimal, reuses existing paths)

1. `readHostedFamilyInviteAcceptanceView` (`family-plan.ts`):
   - Select `targetTelegramUsernameLookupKey`; add `isTelegramBound`; gate
     `telegramInviteUrl` on it (env bot username alone is not enough).
   - Add `messagesRecipientPhone`: for a phone-bound pending invite, resolve the
     existing member's home line via `lookupHostedMemberIdentityByPhoneLookupKey`
     + `readHostedMemberRoutingState` (null for brand-new invitees).
   - Add pure `buildHostedFamilyInviteMessagesHref` (sms deep link whose body is
     exactly the `family_<code>` token the webhook parses). No backend/webhook
     change: `acceptHostedFamilyInviteFromPhoneTx` via `webhook-provider-linq.ts`
     already accepts it.
2. Accept page (`app/family/accept/[inviteCode]/page.tsx`): rebuild on
   `JoinInviteCenteredShell` + `PageHeader` + `Card` + `JoinInviteEyebrow`; CTA
   precedence = authenticated web accept -> Messages (phone-bound, web sign-in as
   compact secondary) -> web sign-in (email-bound) -> Telegram (telegram-bound) ->
   channel-neutral fallback. Fall back to a configured Murph line when no member
   home line resolves.
3. `FamilyInviteSignInButton`: add a compact `link` variant for the secondary
   web option in the Messages case.

## Invariants to preserve

- Product-Critical Flow Preservation: every invite variant keeps a working accept
  CTA (phone -> Messages, email -> web, telegram -> Telegram, else -> guidance).
- Durable Authority: the invite token in the sms body is a client-supplied
  request; the webhook re-asserts authority by matching the sender phone.
- No new ingress/auth surface: the sms link only feeds the existing, documented
  accept-by-phone webhook.

## Verification

- `apps/web` typecheck + lint clean.
- Unit: `family-accept-page`, `hosted-family-owner-snapshot`,
  `hosted-family-invite-messages` (incl. an assertion that the prefilled sms body
  round-trips through `parseHostedFamilyInviteStartToken`), plus regression run of
  `family-invite-accept-route`, `hosted-family-plan`,
  `settings-hosted-family-manager`, `hosted-onboarding-member-channel-sync`.
- Browser visual pass on the Vercel preview (desktop + mobile) recommended before
  merge; the page reuses the established `/join` invite shell primitives.

## Notes

- Avoid the active `Hosted ingress wake repair` lane (webhook-provider files); this
  change does not touch them.
Status: completed
Updated: 2026-07-06
Completed: 2026-07-06

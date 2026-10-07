# Native phone and Telegram messaging setup

Status: active
Created: 2026-10-06
Updated: 2026-10-07

## Outcome and authority

Members link their first phone or Telegram identity inside either native app,
using the canonical credential owner without another Murph browser sign-in.
Murph is the source of truth; downstream changes belong to Android PR 52 and
iOS PR 177. Android remains stacked on the unchanged PR 51.

After required CI and ReviewGPT pass, merge order is backend, production Ready
and unauthenticated endpoint smoke, Android 51 then 52, then iOS. Android 52 also
waits for its registered native redirect host. App publication, native canary
pins, secret changes and real-member mutations are excluded.

## Current protocol

- Reuse first-messaging eligibility, canonical identity conflicts, fresh primary
  proof, current-session revalidation, SMS limits and atomic credential writes.
  Protected members retain account-settings approval; stale proof needs login.
- Native Telegram start binds a five-minute pending record to the exact native
  member/session. The approved unmodified SDK path verifies signature, issuer,
  audience, expiry and two-minute iat freshness. Atomic global token-hash
  consumption prevents replay across fresh starts. Web nonce checks stay intact.
- Remove the bot start-link, recipient proof and hosted return page. No Murph
  code exchange or new client secret. Official native SDKs own authentication.
- Attempt the normal welcome once through the existing Telegram API owner.
  Accepted private-chat delivery promotes the canonical thread after checking
  that the identity has not changed. Failure preserves awaiting-inbound.
- The additive initial-onboarding flag exposes awaiting-inbound to new clients;
  existing messagingSetupRequired semantics and older browser apps are preserved.

## Product UX

Default phone entry uses the existing country picker and Send code button,
then a muted or divider and secondary Connect Telegram. Sign out stays in the
bar. SMS code entry remains the existing login pattern. Telegram uses centered
confirming progress, then continuation or an explicit say-hi fallback. Errors
are inline, with settings fallback only where existing policy requires it.
Pending native state stays in memory and is fenced on sign-out/member changes.

Journeys to prove: phone verification, Telegram approval and cancellation,
accepted welcome, rejected send and inbound recovery, conflict, expiry,
rate limit, stale/revoked sessions, duplicate submission and account switching.
Both native apps need fresh matching synthetic captures, including large text.

## Implementation and proof

The current backend candidate passes 164 tests in five focused suites, including
wrong member/session, cookies, no/expired start, stale/future/missing iat,
wrong issuer/audience, replay across a fresh member start, conflicts, rate limits,
concurrency and accepted/rejected delivery. Web typecheck passes.

## SDK and completion boundary

The human approved using both official SDKs unmodified, with the native proof
controls above instead of a nonce. iOS SDK revision is
215851df7e3cd32787a0054e5d1a97d7aa62796e. Android uses official Maven
org.telegram:login-sdk:1.0.0. Both registered iOS domains serve their app
associations. Android's redirect host and GitHub Packages read credentials remain
human setup. Native work, exact-head evidence and final review are ongoing.

The human authorized manual ReviewGPT submission using normal packaged prompts
and normal result validation while another engineer repairs the launcher. Do not
change or publish ReviewGPT; perform manual submissions only after implementation
and verification. No real SMS, Telegram approval/delivery or physical-device
proof has been performed. All merges still require passed review and hosted CI.

## Final projection regression

Parent integration inspection reproduced an existing-phone plus pending-Telegram
case where the additive native flag would reopen messaging setup despite a
usable direct route. The new route matrix fails before the fix and passes when
the native waiting flag is derived from both missing direct delivery and pending
Telegram. Legacy setup semantics remain unchanged. The focused route suite has
12 passing cases; web typecheck and ordinary guards are rerun for this change.

The first manual round-three attempt at 91c27002ab8ae2020c7d707622d9e0559a794cfe
returned no findings after 6m27s, but named PR UNKNOWN. Its identity is invalid;
no valid round or PASS is recorded. Preserve its local response as diagnostics
and retry round three with the canonical target invocation after this fix.

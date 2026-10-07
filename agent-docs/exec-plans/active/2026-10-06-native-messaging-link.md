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
- Native Telegram start uses the web proof owner with a separate member/session
  purpose and no cookies. The signed ID token must contain the exact server
  nonce. The proof expires in five minutes and is consumed with the credential.
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

Backend implementation now replaces the earlier bot-link protocol with signed
nonce proof and accepted-welcome promotion. Five focused suites pass 157 tests:
member PostgreSQL composition, Telegram PostgreSQL composition, transport,
Telegram webhook routing and companion initial-onboarding projection. Tests
cover wrong nonce/member/session, cookies, replay, expiry, conflict, rate limit,
stale/revoked/protected accounts, concurrent completion, accepted/rejected sends
and identity removal during delivery. Web typecheck and complexity guard pass.

## Current external SDK boundary

The current official iOS revision 215851df7e3cd32787a0054e5d1a97d7aa62796e
and Android revision f9d5ec36ba2433bc5f103b5cd8289f43a05f9336 have no nonce
argument or nonce serialization on either login path. Unmodified SDK tokens
therefore cannot pass the required backend verification. A minimal pinned nonce
patch versus waiting for upstream support needs a decision. Do not silently
accept tokens lacking the signed nonce or replace it with local session state.

Both registered iOS domains publicly serve the correct app associations. Native
entitlements, SDK integration, UI, captures, focused tests, CI and final review
remain outstanding. Android's real redirect host is pending. No production
SMS, Telegram approval/delivery or physical-device behavior has been verified.

# Fix phone account linking

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Make phone linking add or replace a phone on the already-authenticated Murph
  identity without creating or signing into a second provider identity.

## Success criteria

- A matched phone-less identity uses Privy's link-phone flow.
- A matched identity with a phone uses Privy's update-phone flow.
- Settings and join-invite account mutations fail closed when the app and
  provider sessions do not identify the same user.
- A successful provider operation synchronizes the verified phone to Murph once.
- The SMS login controller exposes authentication only, not account linking.
- Focused tests, web typecheck, design proof, review gates, and exact-head CI pass.

## Scope

- In scope: Settings phone add/change, join-invite messaging setup, exact-session
  identity mutation gates, removal of the dead SMS-login link mode, focused
  regression coverage, and design-catalog proof.
- Out of scope: production data repair, provider dashboard changes, and the
  separate secure-approval/passkey session-binding issue.

## Constraints

- Technical constraints: preserve the server phone-sync authority; use canonical
  Privy link/update hooks; never let a login primitive implement linking.
- Product/process constraints: preserve existing auth and onboarding flows,
  avoid customer evidence in artifacts, and ship through the frontend PR lane.

## Risks and mitigations

1. Risk: a stale provider client mutates a different identity before server sync
   rejects it.
   Mitigation: require both the server match and the live provider user ID before
   mounting or invoking identity mutation controls.
2. Risk: provider callbacks use `sms` rather than the UI label `phone`.
   Mitigation: follow the installed SDK callback contract and cover it directly.
3. Risk: an existing phone is sent through an add-only flow.
   Mitigation: derive link versus update from the exact live provider user.

## Tasks

1. Replace login-based phone linking with provider account-management hooks.
2. Thread exact session identity through Settings and join-invite surfaces.
3. Delete the dead link intent from the SMS login controller.
4. Add focused regressions and a synthetic design-catalog study.
5. Run scoped verification, browser proof, review gates, commit, and PR checks.

## Decisions

- Privy's live user is the source of truth for link versus update; the Murph
  snapshot remains the display source.
- The Settings identity dialog owns one shared exact-session boundary for phone,
  email, and Telegram mutation children.
- Join-invite also gates Telegram and withholds its provider seed on mismatch.

## Verification

- Commands to run: focused Vitest files, hosted-web typecheck, frontend design
  proof, desktop/mobile browser proof, scoped workflow checks, ReviewGPT, and
  required PR CI.
- Expected outcomes: no provider mutation on mismatch, one phone sync on
  successful link/update, no production login-based link path, and green checks.

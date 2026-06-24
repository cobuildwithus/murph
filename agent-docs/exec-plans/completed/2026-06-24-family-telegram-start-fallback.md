# Family Telegram Start Fallback

## Goal

Let a Telegram family invitee join from the ordinary `/start` message when the
invite was pre-bound to their Telegram username and Telegram drops the deep-link
start payload.

## Scope

- Store a privacy-preserving Telegram username lookup on family invites.
- Resolve plain Telegram `/start` to exactly one pending username-bound invite.
- Keep explicit `family_<token>` acceptance working.
- Add focused tests and update the Family spec.

## Verification

- Focused hosted family and Telegram webhook tests.
- Hosted web TypeScript check if the local tree allows it.
Status: completed
Updated: 2026-06-24
Completed: 2026-06-24

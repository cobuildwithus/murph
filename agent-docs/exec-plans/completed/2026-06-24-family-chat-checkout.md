# Family Chat Checkout

## Goal

Make Murph's chat Family plan flow friendly when the owner does not yet have an active Family plan: the assistant should provide a checkout link from the family tool, then create invites once billing is active.

## Scope

- Extend the hosted Family dynamic tool contract with the smallest checkout/start action.
- Reuse the existing hosted Family checkout service and account-group state.
- Keep invite creation, invite acceptance, and privacy boundaries unchanged.
- Add focused parser, assistant-tool, and hosted-web tests for inactive/active plan scenarios.

## Non-Goals

- No generic billing-plan manager.
- No Telegram DM initiation to arbitrary usernames.
- No owner access to member health data or conversations.
- No UI redesign.

## Verification

- Focused hosted-execution parser tests.
- Focused assistant-engine dynamic tool tests.
- Focused apps/web Family plan tests.
- Typecheck/build for affected owners as needed.
Status: completed
Updated: 2026-06-24
Completed: 2026-06-24

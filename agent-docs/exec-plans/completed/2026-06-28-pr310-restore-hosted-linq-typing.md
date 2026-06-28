# PR 310 Restore Hosted Linq Typing

## Goal

Restore hosted Linq typing indicators for current inbound Linq replies without adding durable conversation state or broad new provider-egress authority.

## Constraints

- Keep architecture simple and composable.
- Preserve onboarding and reply delivery invariants.
- Provider-visible Linq typing must only run when the hosted runtime has current inbound-thread proof.

## Plan

1. Pass the current hosted wake into channel typing dependencies.
2. Allow Linq typing only when the requested target matches the current inbound Linq chat.
3. Update focused unit and hosted-local e2e expectations.
4. Run focused verification plus typecheck.

## Verification

- `pnpm --dir packages/assistant-runtime test test/hosted-runtime-channel-activity.test.ts test/hosted-runtime-workspace-assistant-phase.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm test:diff` passed.
- `pnpm hosted-local e2e linq-first-contact` was attempted, but the local Postgres role failed before app code with `permission denied to create database`.
Status: completed
Updated: 2026-06-28
Completed: 2026-06-28

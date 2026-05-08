# Hosted Device Connect Intents

## Goal

Replace hosted assistant raw provider connect links with short first-party Murph connect intents, and bind hosted OAuth callback completion to the authenticated member.

## Scope

- hosted device-sync intent state in `apps/web`
- internal hosted device connect-link response contract
- hosted assistant/runtime connect-link consumers and prompt wording
- hosted OAuth callback owner/session guard
- focused tests and docs

## Constraints

- Keep browser settings connect behavior intact.
- Keep provider OAuth mechanics in `@murphai/device-syncd/public-ingress`.
- Keep `apps/web` as the hosted device-sync control-plane owner.
- Do not store raw provider authorization URLs in connect-intent state.
- Preserve unrelated dirty worktree changes.

## Verification

- Focused hosted device-sync route/store tests.
- Focused assistant-runtime/device connect tests.
- Typecheck or report unrelated blockers.

## State

- Implemented `device_connect_intent` schema and first-party `/device/connect/:claim` confirmation route.
- Internal hosted connect-link route now returns `connectUrl` plus compatibility `authorizationUrl`, both pointing at the Murph route.
- Hosted provider callback now requires an active hosted app session and consumes OAuth state only for that member.
- Shared hosted/CLI contracts tolerate old `authorizationUrl` responses while preferring `connectUrl`.
- Focused tests passed for hosted-web connect intent/route/store/callback, device-sync public ingress, assistant-runtime bridge, CLI hosted connect, operator-config device schema smoke, and assistant hosted-connect prompt/final coverage.
- `@murphai/hosted-web typecheck` is blocked before TypeScript by an unrelated Health Commons duplicate source identity; direct web `tsc` passed after route stubs and Prisma generation.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09

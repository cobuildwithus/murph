# Linq Egress Guard Simplification

## Goal

Remove stale hosted Linq egress guard complexity that can block valid hosted
automation delivery after message generation, while preserving concrete
authority checks for signup welcome, routed thread/group sends, and typing
pacing.

Success criteria:

- Hosted automation engagement remains owned by reconciliation facts and
  `hosted_linq_daily_state`, not delivery egress.
- Participant-target Linq sends remain limited to signup welcome first contact.
- Route authority no longer shadows normal delivery with a stale thread-route
  assertion.
- Typing uses direct cadence/session/cooldown controls instead of a web DB
  egress authority assertion.
- Post-send delivery outcome recording does not fail solely because a routed
  thread proof is stale.
- Obsolete member/thread recency columns are removed from Prisma schema,
  migrations, tests, and seeds.

## Constraints

- Preserve wrong-user and wrong-target fail-closed checks.
- Do not weaken phone-number deliverability policy: signup welcome remains the
  only first-contact participant send.
- Do not remove `routeAuthority` as group/thread context until all runtime
  group/thread consumers have another source.
- Keep provider payloads, secrets, phone numbers, message bodies, and direct
  identifiers out of diagnostics, docs, and tests.
- Avoid new state or new schedulers; prefer deletion and direct predicates.

## Working Set

- `apps/web/src/lib/hosted-onboarding/linq-egress-engagement.ts`
- `apps/web/app/api/internal/hosted-runtime/linq-egress/delivery/route.ts`
- `packages/assistant-runtime/src/hosted-runtime/channel-activity.ts`
- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- `apps/cloudflare/src/runtime-platform/effects-port.ts`
- `apps/cloudflare/test/runner-*.test.ts`
- `agent-docs/operations/imessage-deliverability.md`
- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/migrations/**`
- Focused hosted Linq/runtime tests and seed helpers

## Verification Plan

- Focused unit tests for Linq egress authority, delivery outcome recording,
  typing activity, and schema-related hosted onboarding fixtures.
- `pnpm test:diff` over the touched paths if it remains a truthful scoped lane.
- `pnpm typecheck` or report any unrelated pre-existing blocker.

## Deployment Notes

This spans web and hosted runtime bundle behavior. Web must tolerate old runtime
calls during rollout; runtime-side deletion of the old assertion call should
deploy after the web route accepts the simplified authority contract.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07

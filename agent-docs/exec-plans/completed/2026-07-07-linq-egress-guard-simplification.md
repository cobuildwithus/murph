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

Safe deploy order:

1. Deploy web with the simplified engagement route and the stale-column drop.
2. Deploy Cloudflare/runner bundles that stop sending the deleted delivery
   engagement assertion.

Gradual rollout behavior:

- Warm old runner bundles can still call the web engagement route with either
  `routeAuthority` or legacy `currentInbound`; the web route keeps both inputs
  accepted during this rollout.
- `container_rollout=immediate` is not required. Immediate rollout is acceptable
  if operationally convenient, but not required for correctness.

Schema-drop proof:

- The dropped `hosted_member_routing` and `hosted_thread_route` recency columns
  are not referenced by application source on the base branch; the remaining
  references are Prisma schema, migration DDL, and migration tests.
- Base-branch application reads of the affected tables use explicit Prisma
  `select` shapes, so a warm old web process or code rollback does not
  implicitly select the dropped scalar fields.
- Runtime recency decisions are already owned by reconciliation facts and
  `hosted_linq_daily_state`, not by these columns.

Rollback floor:

- Web and Cloudflare can roll back to the base branch for this PR because the
  base application source does not read or write the dropped columns.
- Rolling back to any older revision that explicitly names these recency columns
  outside schema/migration/test code requires restoring the columns first.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07

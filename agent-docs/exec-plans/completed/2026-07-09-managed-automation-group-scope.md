# Managed Automation Group Scope

## Goal

Prevent hosted group/thread-container runtimes from receiving or keeping Murph's personal managed automation bundle, including weekly product notes, while preserving explicit group-owned automations such as the family group health newsletter.

## Constraints

- Keep the fix narrow at the managed automation seeding/reconciliation boundary.
- Do not alter group newsletter scheduling or delivery.
- Preserve personal hosted runtime managed automations.
- Do not expose message content, phone numbers, or private identifiers in tests or logs.

## Plan

1. Mark the default personal managed automation seed bundle as excluded from Linq group-chat routes.
2. Skip creation when the resolved route is a Linq group route.
3. Archive existing active personal managed records already bound to Linq group routes.
4. Preserve explicit/custom seeds and group-owned newsletter automations by requiring opt-in on seed data.
5. Add focused engine tests and run scoped verification.

## Verification

- `pnpm --dir packages/assistant-engine test -- managed-automations.test.ts` passed.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm test:diff packages/assistant-engine/src/assistant/managed-automations.ts packages/assistant-engine/test/managed-automations.test.ts` passed through package typechecks/tests, then failed in `apps/cloudflare verify` on a pre-existing dirty hosted-runtime TypeScript error outside this change.
Status: completed
Updated: 2026-07-09
Completed: 2026-07-09

## Goal

- Remove the legacy raw message append path from the owned `apps/web` hosted
  webhook/wake files so Linq and Telegram producers append canonical hosted wake
  inputs instead of `{ eventId, kind, payload, userId }`.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
  - `apps/web/src/lib/hosted-onboarding/webhook-provider-telegram.ts`
  - `apps/web/src/lib/hosted-execution/dispatch-lifecycle.ts`
  - `apps/web/src/lib/hosted-wake/dispatch.ts`
  - directly related `apps/web` tests that assert those paths
- Out of scope:
  - shared `packages/hosted-execution/**` contract changes
  - Cloudflare/runtime queue work already in flight
  - unrelated webhook receipt or onboarding behavior changes unless required to
    keep the owned slice compiling

## Constraints

- Bias toward hard deletion because this branch is greenfield.
- Keep compatibility only when an active caller outside this owned slice still
  requires it.
- Preserve unrelated dirty-tree edits.

## Plan

1. Remove the raw message overload from the web append helpers and normalize the
   owned Linq/Telegram producers onto canonical hosted wakes.
2. Delete dead legacy conversion helpers in the owned web wake/dispatch files if
   no active caller still needs them.
3. Update the directly related hosted web tests and run scoped verification for
   the touched `apps/web` slice.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-wake-dispatch.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts --no-coverage`
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web exec tsc --noEmit`
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18

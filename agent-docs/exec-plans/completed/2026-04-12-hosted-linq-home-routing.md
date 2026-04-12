# Hosted Linq Home Routing

## Goal

Land the supplied hosted Linq routing patch so pre-activation ingress stays separate from the stable post-activation home line, activation can assign a persistent Linq home conversation once, and active users on non-home Murph lines are redirected instead of silently rebound.

## Why

- The current tree still uses one mutable `linqChatId` binding, which does not support the requested greenfield routing split.
- The supplied patch also lays the routing groundwork for a future non-Linq acquisition path without landing Twilio ingress in the same change.

## Scope

- hosted onboarding Linq routing/runtime code under `apps/web/src/lib/hosted-onboarding/**`
- hosted onboarding Linq and routing tests under `apps/web/test/**`
- hosted web Prisma schema and baseline migration under `apps/web/prisma/**`
- durable doc updates only if the landed diff changes an architecture-significant rule that is not already documented

## Constraints

- Preserve unrelated concurrent `apps/web` work and do not broaden beyond the supplied routing patch except for direct compatibility or verification fixes.
- Treat the patch as behavioral intent, not overwrite authority; inspect the landed diff against current HEAD before committing.
- Do not expose personal identifiers from local paths, usernames, or legal names in repo files, commits, or handoff text.
- Because the patch edits the baseline Prisma migration, call out that existing local hosted DBs may need reset/recreate after landing.

## Verification

- Prefer a truthful `pnpm test:diff apps/web` lane if available in the current environment; otherwise use the required `apps/web` verification lane from repo policy.
- Record any environment blockers exactly if workspace dependencies are unavailable.
- Inspect the final diff for accidental scope creep and identifier leakage before commit.

## Result

Status: completed
Updated: 2026-04-12

## Verification Outcome

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-member-store.test.ts apps/web/test/hosted-onboarding-member-service.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-linq-routing.test.ts apps/web/test/hosted-onboarding-linq-home-routing.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-stripe-billing-policy.test.ts`
- `pnpm test:diff apps/web`
- `pnpm typecheck` (blocked only by a pre-existing unrelated `packages/assistant-engine/test/assistant-store-persistence.test.ts` nullability error after `apps/web` had already passed)
- direct scenario proof via `pnpm exec tsx --eval` over `linq-routing-policy.ts`

## Notes

- Review-driven follow-ups tightened the fail-closed behavior so a mismatched home chat never rebinds when the incoming recipient metadata is missing or the stored home line is unknown.
- Added boundary tests for activation-time pending-thread reuse, pooled home-chat creation, sparse-payload fail-closed behavior, and active-user redirect handling.
Completed: 2026-04-12

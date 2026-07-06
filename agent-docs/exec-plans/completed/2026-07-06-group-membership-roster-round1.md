# Group Membership Roster Round 1 Fixes

## Goal

Apply the PR 398 round 1 fixes:

- Use one canonical participant-aware thread-container access resolver for route admission, egress, usage allowance, and runtime access.
- Bound foreground group roster reconciliation work with a hard cap and update coverage.

## Constraints

- Keep the owner-active path short-circuited so healthy owner-authorized containers do not query participants.
- Suspended containers remain a hard block.
- Usage ownership and budgets stay anchored to the container member.
- Reconcile must not scan or upsert beyond the cap.

## State

Implementation complete; ready for scoped commit.

## Verification

Planned:

- Focused hosted web tests touching access and group roster behavior.
- `pnpm --dir apps/web prisma:generate`
- `pnpm --dir apps/web typecheck`

Completed:

- `pnpm --dir apps/web prisma:generate`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web test -- hosted-onboarding-entitlement.test.ts runtime-access.test.ts hosted-execution-usage-allowance.test.ts hosted-thread-route-store.test.ts hosted-group-tool.test.ts hosted-onboarding-linq-thread-route.test.ts hosted-orchestration-signal-runtime.test.ts hosted-runtime-internal-routes.test.ts`
- `pnpm --dir apps/web lint` (warnings only in unrelated existing files)
- `git diff --check`
Status: completed
Updated: 2026-07-06
Completed: 2026-07-06

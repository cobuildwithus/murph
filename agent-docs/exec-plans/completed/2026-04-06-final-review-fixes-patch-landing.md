## Goal (incl. success criteria):
- Land the remaining production-worthy fixes from the supplied `final-review-fixes.patch` without overwriting live-tree drift.
- Success means the Privy reconciliation path is serialized against the current split hosted-member identity model, Stripe activation honors `skipIfBillingAlreadyActive` correctly, terminal billing attempts clear `checkoutUrl`, routing reads fail soft to legacy columns during migration drift, and focused proofs cover the changed paths.

## Constraints/Assumptions:
- Preserve unrelated dirty-tree edits, especially the active assistant-core split and other hosted-web changes outside this lane.
- Treat the supplied patch as behavioral intent only; current code has already diverged to the split identity/routing/billing-ref store model.
- Keep this landing narrow to the four touched hosted onboarding files plus the minimum test coverage needed to prove them.

## Key decisions:
- Adapt the Privy race fix to the current `HostedMemberIdentity` split instead of reintroducing member-column authority.
- Prefer read fallbacks to legacy routing columns over new dual-write behavior, matching the patch intent without increasing retained data.
- Capture focused verification directly even if the repo-wide wrappers remain blocked by the active assistant-core workspace drift.

## State:
- completed

## Done:
- Read the supplied patch and summary.
- Confirmed the patch does not apply cleanly because the live tree has drifted in `member-identity-service`, `stripe-billing-policy`, and `hosted-member-store`.
- Read the current live versions of the four touched files and identified the main adaptation point: the live tree already uses `HostedMemberIdentity`/`HostedMemberRouting` split stores.
- Registered this lane in the coordination ledger.
- Adapted the Privy identity reconciliation fix to the current split-store model by locking and re-reading the current hosted member before writing identity state.
- Cleared `checkoutUrl` on failed, completed, and expired hosted billing attempts.
- Added focused unit coverage for the new reconciliation lock/re-read behavior and the billing-attempt terminal cleanup, and updated the existing Privy-service harness for the new locked member reload.
- Verified the touched lane with direct-file Vitest, app-local TypeScript, app-local ESLint, one explicit reconciliation scenario test run, and `pnpm --dir apps/web lint`.
- Confirmed `stripe-billing-policy.ts` already matched the patch intent, so no live-tree code change was needed there.
- Confirmed the `hosted-member-store.ts` routing fallback hunk is obsolete in the live tree because the current Prisma schema no longer carries the legacy Linq/Telegram columns on `HostedMember`.
- Captured the repo-wide wrapper failures as unrelated pre-existing assistant-core workspace-boundary drift.

## Now:
- Close the plan and commit the scoped hosted-onboarding files plus this completed plan artifact.

## Next:
- UNCONFIRMED: once the active assistant-core workspace-boundary refactor settles, re-run the repo-wide `workspace-verify` wrappers for a full green baseline.

## Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether you still want a follow-up hard cut for any remaining hosted-member compatibility seams beyond the already-removed routing columns.

## Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-06-final-review-fixes-patch-landing.md`
- `apps/web/src/lib/hosted-onboarding/member-identity-service.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-billing-policy.ts`
- `apps/web/src/lib/hosted-onboarding/billing-attempts.ts`
- `apps/web/src/lib/hosted-onboarding/hosted-member-store.ts`
- `/Users/willhay/Downloads/final-review-fixes.patch`
- `/Users/willhay/Downloads/final-review-summary.md`
Status: completed
Updated: 2026-04-06
Completed: 2026-04-06
Completed: 2026-04-06

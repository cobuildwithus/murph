## Goal (incl. success criteria):
- Land the remaining behavior from the supplied `final-prod-readiness.patch` without overwriting live-tree drift that already absorbed earlier onboarding/docs hunks.
- Success means hosted share creation no longer trusts arbitrary `senderMemberId`, suspended members fail closed in share flows with the right errors, and focused hosted-share tests prove the tightened behavior.

## Constraints/Assumptions:
- Preserve unrelated dirty-tree edits, especially the active assistant-core package split and adjacent hosted onboarding changes already in the worktree.
- Treat the supplied patch as behavioral intent only; port missing deltas manually instead of forcing a stale patch apply.
- Keep the change narrow to the hosted share/auth lane unless a read-through proves another hunk from the patch is still missing and materially related.

## Key decisions:
- Reuse the existing hosted entitlement helpers where they already encode the correct active-versus-suspended semantics instead of copying the patch's older inline status checks.
- Keep the already-landed onboarding and docs text unchanged when the live tree already matches the patch intent.
- Add focused hosted-share tests for sender validation and suspended-member failure behavior so the trust-boundary tightening stays covered.

## State:
- completed

## Done:
- Read the required routing, architecture, security, reliability, verification, and completion-workflow docs.
- Checked the supplied patch against the live tree and confirmed the onboarding/docs hunks are already present.
- Narrowed the remaining live deltas to hosted share sender validation and suspended-member handling.
- Registered this lane in the coordination ledger.
- Added sender-member existence and entitlement checks before hosted share creation writes any share pack or Postgres row.
- Tightened hosted share acceptance so suspended members fail closed with the specific suspension error instead of the generic inactive-access error.
- Extended the focused hosted-share tests to cover missing senders, suspended senders, and the new suspended-member acceptance error.
- Verified the touched hosted-share lane directly with focused Vitest, app-local TypeScript, app-local ESLint, and a one-test direct scenario run.
- Captured the repo-wide wrapper failures as unrelated pre-existing assistant-core workspace-boundary drift.

## Now:
- Close the plan and commit the scoped hosted-share files plus this completed plan artifact.

## Next:
- UNCONFIRMED: once the active assistant-core workspace-boundary refactor settles, re-run the repo-wide `workspace-verify` wrappers for a full green baseline.

## Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether the supplied patch intended any additional hosted-share cleanup beyond sender validation and suspended-member errors that is still missing in the live tree.

## Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-06-final-prod-readiness-patch-landing.md`
- `apps/web/src/lib/hosted-share/link-service.ts`
- `apps/web/src/lib/hosted-share/acceptance-service.ts`
- `apps/web/test/hosted-share-service.test.ts`
- `/Users/willhay/Downloads/final-prod-readiness.patch`
Status: completed
Updated: 2026-04-06
Completed: 2026-04-06
Completed: 2026-04-06

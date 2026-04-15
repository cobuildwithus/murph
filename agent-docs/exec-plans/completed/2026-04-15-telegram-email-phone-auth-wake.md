# Telegram/email/phone hosted-auth wake patch

Status: completed

## Goal

Land the returned ChatGPT patch for hosted onboarding/auth so phone, Telegram, and email signup flows share one minimal messaging-availability seam and the hosted UI/settings match that server-owned state.

## Success criteria

- The returned patch applies cleanly or is adapted minimally for current repo state.
- Hosted onboarding and settings changes remain scoped to the returned patch behavior.
- Required verification runs for the touched owners and any unrelated blockers are documented clearly.
- Required completion-workflow audit passes run before handoff.

## Scope

- `apps/web/**` hosted onboarding, settings, and related server/client flows touched by the returned patch
- `packages/hosted-execution/**` contract/parser updates included in the returned patch
- Coordination/commit artifacts required by repo workflow

## Constraints

- Treat the returned patch as behavioral intent, not overwrite authority.
- Keep the change scoped to the downloaded artifact.
- Preserve unrelated worktree edits.
- Do not add dependency changes.

## Tasks

1. Confirm why the saved wake run reported no downloaded artifacts and refresh the attachment if needed.
2. Apply the returned patch and review the resulting diff for current-repo fit.
3. Run the required verification lane for `apps/web` plus touched package owners.
4. Run required completion-workflow audit passes, then finish with a scoped commit.

## Risks and mitigations

- Auth/onboarding changes cross trust boundaries.
  Mitigation: keep the patch scoped, read security guidance first, and verify the hosted app lane rather than skipping to narrow file-only checks.
- The returned patch may assume stale repo state.
  Mitigation: review the applied diff, fix only current-state incompatibilities, and avoid opportunistic refactors.
- The wake helper script includes a placeholder artifact-download command.
  Mitigation: rely on the refreshed exported thread plus the successfully downloaded concrete artifact and ignore the expected placeholder failure.

## Verification

- Completed: required completion-workflow audit passes (`coverage-write`, `task-finish-review`)
- Passed: `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --no-coverage test/settings-phone-sync-route.test.ts test/settings-telegram-sync-route.test.ts test/join-invite-client.test.ts test/hosted-onboarding-member-store.test.ts test/hosted-onboarding-billing-service.test.ts test/hosted-onboarding-member-activation.test.ts test/hosted-onboarding-privy-service.test.ts`
- Passed: `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts --no-coverage test/hosted-execution-parsers-coverage.test.ts`
- Passed: `pnpm --dir packages/hosted-execution build`
- Blocked unrelated to this diff: `pnpm typecheck` currently fails in `packages/inbox-services`
- Blocked unrelated to this diff: `bash scripts/workspace-verify.sh test:diff apps/web packages/hosted-execution` currently fails early in `packages/cli`
Updated: 2026-04-15
Completed: 2026-04-15

Goal (incl. success criteria):
- Resolve PR 343 ReviewGPT round 1 finding: inbound Linq replies to ops-created voice-first chats must honor the pending chat binding.
- Success means the webhook planner resolves `pendingLinqChatId` before treating a reply as unrelated first contact, issues the signup link for the original member, and focused tests prove the email-handle/media-only reply case.

Constraints/Assumptions:
- Keep the fix minimal in the existing Linq webhook planner/member-routing path.
- Do not add new state, queues, reconciliation loops, or new ownership concepts.
- Preserve existing identity, pending-contact, and home-chat resolution behavior.
- ReviewGPT artifacts stay under ignored `audit-packages/` and uncommitted.

Key decisions:
- Accept the finding as real because the current planner does not read pending chat id during first-contact member resolution.
- Add pending chat id lookup after identity/pending-contact lookup and before home-chat fallback.

State:
- Ready to close with scoped commit.

Done:
- ReviewGPT round 1 completed for PR 343 with one High finding.
- Verified the missing pending-chat lookup by reading the webhook planner resolution order.
- Patched `planHostedOnboardingLinqWebhook` to resolve pending Linq chat bindings before home-chat fallback.
- Added a regression test for email-handle media replies in an ops-created pending Linq chat.
- Updated the webhook idempotency mock for the new routing-store export.
- Verification passed:
  - `git diff --check`
  - `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --project hosted-web-onboarding-core test/hosted-onboarding-webhook-idempotency.test.ts --no-coverage`
  - `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --project hosted-web-onboarding-integrations test/hosted-onboarding-linq-dispatch.test.ts --no-coverage`
  - `pnpm test:diff apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`

Now:
- Close the plan with a scoped commit and push the PR branch.

Next:
- Rerun ReviewGPT, wait for CI, and merge when green.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts
- apps/web/test/hosted-onboarding-linq-dispatch.test.ts
- apps/web/test/hosted-onboarding-webhook-idempotency.test.ts
- audit-packages/pr-343-round-1.md (ignored, uncommitted)
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30

Goal (incl. success criteria):
- Resolve or defensibly reject PR 343 ReviewGPT round 2 findings.
- Success means pending Linq chat authority cannot route an ops-created chat reply to another member, and ReviewGPT has zero accepted findings before merge.

Constraints/Assumptions:
- Keep changes narrow in the existing Linq webhook and ops invite paths.
- Preserve the user-requested voice-only new-chat opener with no text and no invite link.
- Do not add durable state or idempotency machinery unless the code path proves it is required for safety.
- ReviewGPT artifacts stay under ignored `audit-packages/` and uncommitted.

Key decisions:
- Accept the pending-chat authority finding as real until code proves otherwise.
- Inspect the media-send idempotency finding before accepting it, because the user explicitly deprioritized idempotency and the current design intentionally avoids new state.

State:
- Ready to close with scoped commit.

Done:
- ReviewGPT round 2 completed for PR 343.
- Patched Linq webhook planning so a pending chat binding is looked up for every reply and cross-member identity/contact conflicts fail closed before side effects.
- Added regression coverage for pending-chat sender identity mismatch.
- Kept the voice-first media send design state-free: the stable identity is the Linq chat/message idempotency key derived from request id plus sender/recipient target facts; attachment id is excluded because attachment creation has no stable idempotency field.
- Added retry coverage proving a same-request media-chat retry restores the pending binding after a post-create database failure.
- Updated a usage-reset test mock to expose the new pending-chat lookup surface.
- Verification passed:
  - `git diff --check`
  - `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --project hosted-web-onboarding-integrations test/hosted-onboarding-linq-usage-reset-e2e.test.ts --no-coverage`
  - `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --project hosted-web-onboarding-integrations test/hosted-onboarding-linq-dispatch.test.ts --no-coverage`
  - `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --project hosted-web-store-config test/hosted-ops-onboarding-invites.test.ts --no-coverage`
  - `pnpm test:diff apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/src/lib/hosted-ops/onboarding-invites.ts apps/web/test/hosted-ops-onboarding-invites.test.ts apps/web/test/hosted-onboarding-linq-usage-reset-e2e.test.ts`

Now:
- Close the plan with a scoped commit and push the PR branch.

Next:
- Rerun ReviewGPT, wait for CI, and merge when gates allow.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts
- apps/web/test/hosted-onboarding-linq-dispatch.test.ts
- apps/web/src/lib/hosted-ops/onboarding-invites.ts
- apps/web/test/hosted-ops-onboarding-invites.test.ts
- apps/web/test/hosted-onboarding-linq-usage-reset-e2e.test.ts
- audit-packages/pr-343-round-2.md (ignored, uncommitted)
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30

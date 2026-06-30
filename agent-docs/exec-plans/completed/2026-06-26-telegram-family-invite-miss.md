Goal (incl. success criteria):
- Keep Telegram Family invite-token misses from surfacing as webhook failures.
- Success means a wrong-username or otherwise non-acceptable Family invite sent to Telegram returns an ignored ok response and does not route or wake the assistant.

Constraints/Assumptions:
- Keep this commit provider-scoped; the domain preflight fix is already separate.
- Preserve normal active-member Telegram routing and unexpected error fail-closed behavior.
- Do not add durable state for rejected invite attempts.

Key decisions:
- Classify only non-retryable hosted Family invite acceptance business errors as ignored token misses.
- Return the shared `family-invite-not-accepted` reason for explicit Family tokens or expected `/start` fallback misses.

State:
- In progress.

Done:
- Confirmed Telegram provider lets expected Family invite acceptance errors escape the webhook planner.

Now:
- Patch Telegram planner and add focused webhook regression coverage.

Next:
- Run focused Telegram tests and typecheck before a scoped commit.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/webhook-provider-telegram.ts
- apps/web/test/hosted-onboarding-telegram-dispatch.test.ts
Status: completed
Updated: 2026-06-26
Completed: 2026-06-26

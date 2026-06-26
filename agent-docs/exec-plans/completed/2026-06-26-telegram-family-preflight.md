Goal (incl. success criteria):
- Prevent Telegram Family invite acceptance from creating a hosted member/routing before proving the invite belongs to the sender's Telegram username.
- Success means explicit Telegram Family tokens bound to another username fail before member creation, domain-root provisioning, routing upsert, invite update, or membership upsert.

Constraints/Assumptions:
- Keep the fix inside Family invite domain logic.
- Preserve existing fallback behavior for stale explicit tokens that match a username-bound pending invite.
- Do not add new state or change web/phone invite acceptance.

Key decisions:
- Add a narrow preflight check for active explicit Telegram tokens before creating a member.
- Keep the existing `acceptHostedFamilyInviteTx` check as the authoritative final guard.

State:
- In progress.

Done:
- Found that `acceptHostedFamilyInviteFromTelegramTx` resolves a member and writes routing before `acceptHostedFamilyInviteTx` checks username binding.

Now:
- Patch Telegram preflight and strengthen the existing mismatch test.

Next:
- Run focused Family plan tests and typecheck before a scoped commit.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/family-plan.ts
- apps/web/test/hosted-family-plan.test.ts
Status: completed
Updated: 2026-06-26
Completed: 2026-06-26

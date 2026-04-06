Repository bootstrap:

- Before editing, read `AGENTS.md` and follow it.
- Treat that file as required worker bootstrap, not optional background context.
- If it points to additional repo docs, follow the stated read order before making code changes.
- If it requires coordination or audit workflow steps, do those explicitly rather than assuming the parent wrapper handled them.

This prompt is for Batch 2 and should run only after Batch 1 foundation changes are reviewed and integrated.

You own the messaging-routing cutover off the wide `HostedMember` row.

Constraints:

- Preserve unrelated dirty-tree edits.
- Assume Batch 1 already introduced the additive routing table and helper layer.
- Do not redesign auth or Stripe billing in this lane.
- Preserve entitlement checks and sanitized webhook payload handling.
- Remove durable `telegramUsername` storage if the live flow can keep returning display username from the current Privy sync result instead.

Goals:

- Move Linq chat binding reads and writes to `HostedMemberRouting`.
- Move Telegram lookup binding reads and writes to `HostedMemberRouting`.
- Keep Linq identity resolution based on phone blind indexes from the identity side.
- Keep Telegram identity resolution based on Telegram blind index from routing state.
- Remove durable `telegramUsername` persistence while preserving current UI display behavior from the live sync result.

Primary files:

- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-telegram.ts`
- `apps/web/app/api/settings/telegram/sync/route.ts`
- any focused routing helper/store files introduced in Batch 1
- related tests under `apps/web/test/**`

Acceptance:

- Routing state no longer reads or writes Linq/Telegram linkage through legacy `HostedMember` columns.
- `telegramUsername` is no longer durably stored.
- Linq and Telegram behavior remain entitlement-safe and privacy-minimized.

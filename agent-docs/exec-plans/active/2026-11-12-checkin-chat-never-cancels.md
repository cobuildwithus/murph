# Chat never cancels a game check-in

Status: active
Created: 2026-11-12
Updated: 2026-11-12

## Goal

- A room's 8pm check-in, its morning missed-day message and a private 8pm text
  go out even when someone writes in the chat while Murph is preparing them.
  Whether a player's words already answer the question is the model's call.

## Cause

- Each check-in froze a conversation-lane watermark and was dropped for the day
  when any new message arrived before dispatch, including unrelated chatter.
  It was observed in production: a message arrived seconds after a room's 8pm
  check-in was queued, with no game fact changed. The claim is per room and
  date, so nothing retried it.

## Success criteria

- A new conversation message no longer makes any of the three check-ins stale
  at reservation, publication, recovery or egress.
- A post, departure, terms change and expiry still stop a prepared check-in.
  For the two evening check-ins, so do a reminder opt-out and the
  unanswered-evening pause.
- A runner built before this change still parses every policy Web writes.

## Scope

- In scope: the watermark recheck in `evening-check-in.ts`,
  `group-missed-day.ts` and `private-notification.ts`; the transcript bound it
  required; the owner docs that stated the rule.
- Out of scope: prompts, the runner, receipts stuck in `generation_queued`
  after a quiet turn, and a tool that would let the model read chat at turn time.

## Constraints

- Web deploys on merge and the runner deploys separately, so the persisted
  policy shape cannot lose a field the deployed runner requires.

## Risks and mitigations

1. Risk: a player answers in chat after the transcript is read and is asked anyway.
   Mitigation: accepted. Past sends left about 15 seconds between preparation
   and send; the old rule traded that for losing the whole day's check-in.
2. Risk: an old runner rejects a policy without `conversationLaneSeq`.
   Mitigation: the schema makes the field optional and Web keeps writing `"0"`.

## Tasks

1. Delete the watermark recheck and the mailbox causal-append lock it took from
   the three currentness checks. Done.
2. Read the transcript as it stands at preparation; drop the bound parameter. Done.
3. Make `conversationLaneSeq` optional in the three policy schemas. Done.
4. Update tests and the architecture, security, product and state-machine docs. Done.
5. Follow-up after the next runner deploy: stop writing `"0"`, then remove the
   field once queued policies that carry it have expired.

## Decisions

- Delete the rule in all three check-ins rather than retry after a mismatch. A
  retry needs a second mailbox item per claim and still races the next message.
- Keep one rule: game facts gate delivery, chat is evidence for the model.
- No prompt change. Each prompt already tells the model to omit what a player
  clearly answered and to stay quiet when nothing remains.
- Codex deep review, accepted: stale watermark wording in one test title and
  the testing map; a private-evening case in the schema test; recovery after
  chat in the Web tests.
- Codex deep review, rejected: making a reminder opt-out stop the missed-day
  message. That message has never read `reminder_off` at reservation,
  publication or egress, so the old rule only stopped it by accident when the
  opt-out arrived as a chat message. Whether the opt-out should cover it is a
  product question outside this fix.
- Left alone: the unused `memberIds` parameter of `isEveningBatchCurrentTx`,
  which predates this change.

## Verification

- `pnpm --dir packages/hosted-execution exec vitest run test/game-group-missed.test.ts`: passed.
- With an isolated migrated `murph_test_*` database and
  `MURPH_TEST_POSTGRES_CONCURRENCY=1`: `game-group-missed-check-in-postgres`,
  `game-private-evening-postgres` and `game-chat-delivery-authority`, 137 passed.
- `pnpm --dir apps/web typecheck:prepared` and
  `pnpm --dir packages/hosted-execution typecheck`: passed.

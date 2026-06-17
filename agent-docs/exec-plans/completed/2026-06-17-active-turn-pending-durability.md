Goal (incl. success criteria):
- Prevent replyable hosted Telegram inputs imported during an active turn from being lost before the next assistant pass.
- Keep pending-input durability simple: imported replyable assistant inputs remain pending until terminal auto-reply evidence or explicit non-replyable state, not merely until an auto-reply cursor advances past them.
- Success means the pending index preserves explicit pending IDs across active-turn/hot-reload timing, and focused tests prove both preservation and terminal cleanup.

Constraints/Assumptions:
- Ignore scheduled reminder execution; that is a separate fix.
- Web remains owner of canonical mailbox facts and ordering.
- Assistant runtime pending state remains operational runtime state, not canonical product truth.
- Do not add a new queue, scheduler, persisted table, or broad runtime abstraction.
- Preserve unrelated working-tree edits and active ledger rows.

Key decisions:
- Treat active-turn admission as an optimization over the durable pending-input index.
- Keep auto-reply cursors useful for backfill/discovery, but do not let them evict explicit pending inputs without terminal evidence.

State:
- In progress.

Done:
- Diagnosed the failure as replyable input crossing mailbox import but disappearing before assistant selection.

Now:
- Patch pending-input selection/compaction and add focused regression tests.

Next:
- Run focused tests, typecheck, required audits, and final scoped commit.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-runtime/src/hosted-runtime/pending-input-index.ts
- packages/assistant-runtime/src/hosted-runtime/turn-input.ts
- packages/assistant-runtime/test/hosted-runtime-pending-input-index.test.ts
- packages/assistant-runtime/test/hosted-runtime-mailbox-conversation-import.test.ts
- packages/assistant-runtime/test/hosted-runtime-turn-input.test.ts
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17

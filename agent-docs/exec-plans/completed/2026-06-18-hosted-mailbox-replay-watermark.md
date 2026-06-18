Goal (incl. success criteria):
- Fix hosted conversation messages that arrive while a reply is already in flight and are imported locally but not accepted into the provider turn.
- Success means durable `consumed_seq` remains the conversation reply-suppression authority, local imported watermarks cannot hide unconsumed conversation rows, system mailbox import behavior stays unchanged, and focused tests cover the replay path.

Constraints/Assumptions:
- Keep the fix hosted-only and do not change local non-hosted Murph assistant cursors.
- Do not add a scheduler, queue, background retry owner, or extra route-level database call.
- Preserve foreground reply priority and existing system-lane mailbox continuity.
- Preserve unrelated working-tree edits and active ledger rows.

Key decisions:
- Fetch conversation mailbox rows after the lower of local imported watermark and durable consumed watermark.
- Keep system lane fetches keyed to the local imported watermark.
- Let the runtime import loop expect replayed unconsumed conversation rows when local state is ahead of durable reply coverage.

State:
- In progress.

Done:
- Diagnosed local `hosted-mailbox.json` imported watermark outrunning durable `consumed_seq` after late input was imported but not provider-accepted.

Now:
- Patch web mailbox fetch cursor resolution and runtime mailbox import ordering checks.

Next:
- Add focused tests for route cursor resolution and runtime replay import, run verification, run required audits, and close the plan.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/app/api/internal/hosted-mailbox/fetch/route.ts
- apps/web/src/lib/hosted-mailbox/store.ts
- apps/web/test/hosted-runtime-internal-routes.test.ts
- packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts
- packages/assistant-runtime/test/hosted-runtime-mailbox-import.test.ts
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17

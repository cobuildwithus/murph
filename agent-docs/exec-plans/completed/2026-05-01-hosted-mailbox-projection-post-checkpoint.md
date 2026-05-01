Goal (incl. success criteria):
- Ensure hosted conversation mailbox import checkpoints the staged mailbox watermark and AssistantInputEvent before any best-effort inbox projection work runs.
- Success means conversation mailbox import order is decode/match -> stage AssistantInputEvent with pending projection -> mailbox checkpoint -> post-checkpoint projection status update.

Constraints/Assumptions:
- Do not widen into hosted Linq/event adapter cleanup or Cloudflare runner behavior.
- Projection is enrichment only; checkpointed assistant input is the Codex admission source.
- Preserve existing sensitive-data minimization in AssistantInputEvent records.

Key decisions:
- Use the existing mailbox `afterCheckpoint` effect path instead of adding a new queue.
- Keep projection failures best-effort and checkpoint-independent.

State:
- Completed. Scoped commit created with a temporary index to avoid unrelated dirty-tree overlap in shared durable docs and the coordination ledger.

Done:
- Reviewed repo workflow, security, reliability, verification, and relevant hosted mailbox import code.
- Registered the ledger row.
- Moved hosted conversation projection into the mailbox post-checkpoint effect path.
- Updated hosted runtime architecture docs to state checkpoint-before-projection.
- Addressed final-review finding by checkpointing mailbox post-checkpoint projection effects separately and best-effort.
- Addressed follow-up final-review finding by skipping the projection maintenance checkpoint when the assistant phase throws, avoiding durable snapshots of partial failed assistant mutations.

Now:
- Done.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/test/hosted-runtime-mailbox-conversation-import.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-mailbox-checkpoint.test.ts`
- `packages/assistant-runtime/README.md`
- `ARCHITECTURE.md`
- `agent-docs/references/hosted-runtime-protocol.md`
- `agent-docs/exec-plans/completed/2026-05-01-hosted-mailbox-projection-post-checkpoint.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-runner.test.ts test/hosted-runtime-mailbox-conversation-import.test.ts test/hosted-runtime-mailbox-checkpoint.test.ts --config vitest.config.ts --no-coverage` passed.
- `pnpm --dir packages/assistant-runtime typecheck` last failed on unrelated active device-sync credential-shape drift.
- `pnpm --dir packages/assistant-runtime test:coverage` last failed on unrelated active device-sync/parser-toolchain drift after the focused mailbox tests passed.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01

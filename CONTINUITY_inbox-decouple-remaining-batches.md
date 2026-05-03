Goal (incl. success criteria):
- Finish the remaining inbox-decouple migration batches after the committed Batch 1/2 foundation.
- Success means producer adapters/hooks write event-owned attachment evidence, prompt construction no longer dereferences inbox projection, hosted/local behavior stays best-effort and source-neutral, docs/residue scans match the guide, and required verification/audits pass or unrelated blockers are named.

Constraints/Assumptions:
- Preserve unrelated dirty work in the shared checkout.
- Do not commit unrelated hosted/web/runtime rows.
- Prompt path must not call `inboxServices.show()` after the hard cut.
- Stored refs must be sanitized vault-relative artifact refs only.

Key decisions:
- Keep Batch 1/2 commit `99102082b` as the base implementation.
- Use source-neutral evidence materialization for prompt input; keep inbox calls only in producer/update paths.

State:
- Verification complete; ready for scoped commit.

Done:
- Batch 1/2 foundation is already committed.
- Remaining guide sections have been read and split into explorer subagent lanes.
- Batch 3/4 local producer path now has the inbox-to-evidence adapter, imported-capture partial evidence writes, parser-drain evidence refresh, and nonblocking failure logging.
- Focused assistant-engine typecheck and adapter/run-loop tests passed after the Batch 3/4 changes.
- Batch 5 hosted projection path now hydrates event-owned attachment evidence post-checkpoint, records failed evidence nonblocking, and logs mailbox post-checkpoint effect outcomes.
- Focused assistant-runtime and hosted-execution typechecks/tests passed for hosted import, runner logging, and runtime-control log contracts.
- Batch 6 prompt construction now uses event-owned `attachmentEvidence`; prompt-time inbox projection loading was removed from `reply.ts` and `prompt-builder.ts`.
- Prompt residue scans show no `InboxShowResult`, old inbox bundle helpers, or enrichment references in the prompt path; the remaining `inboxServices.show` is the producer-side parser-drain refresh in `run-loop.ts`.
- Batch 7/8 cleanup demoted default hosted inbox enrichment warmup, restored attachment-evidence artifact refs during hosted snapshot restore, and updated hard-cut/runtime-state docs.
- Required focused checks passed for assistant-engine, assistant-runtime, runtime-state, and hosted-execution.
- Root `pnpm typecheck` passed.
- Scoped `scripts/workspace-verify.sh test:diff ...` passed on rerun after an unrelated parsers timing failure passed immediately in isolation.
- Final residue scans found no prompt-time inbox show/types/helpers/enrichment residue; the only remaining `inboxServices.show()` call is producer-side parser-drain refresh.
- Final review subagent found no remaining Batch 3-8 issues after neutral raw-artifact refs were introduced.
- `git diff --check` passed and the scoped privacy scan was clean.

Now:
- Stage only the inbox-decouple working set and commit.

Next:
- Close the active plan/ledger and hand off the commit summary.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether the durable hard-cut doc named by the guide exists under the same filename in current main.

Working set (files/ids/commands):
- Plan: `agent-docs/exec-plans/active/2026-05-03-inbox-decouple-remaining-batches.md`
- Likely files: `packages/assistant-engine/src/assistant/inbox-attachment-evidence.ts`, `packages/assistant-engine/src/assistant/automation/run-loop.ts`, `packages/assistant-engine/src/assistant/automation/reply.ts`, `packages/assistant-engine/src/assistant/automation/prompt-builder.ts`, `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`, focused tests.
- Passed: `pnpm --dir packages/assistant-engine typecheck`
- Passed: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-inbox-attachment-evidence.test.ts test/assistant-automation-runtime.test.ts`
- Passed: `pnpm --dir packages/assistant-runtime typecheck`
- Passed: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-mailbox-conversation-import.test.ts test/hosted-runtime-workspace-runner.test.ts`
- Passed: `pnpm --dir packages/hosted-execution typecheck`
- Passed: `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-control.test.ts`
- Passed: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-automation-prompt-builder.test.ts test/assistant-automation-support.test.ts test/assistant-automation-runtime.test.ts`
- Passed: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-conversation-event.test.ts test/hosted-runtime-mailbox-conversation-import.test.ts test/hosted-runtime-workspace-runner.test.ts test/hosted-runtime-workspace-entrypoint.test.ts`
- Passed: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-inbox-attachment-evidence.test.ts test/assistant-attachment-evidence-model.test.ts test/assistant-automation-runtime.test.ts test/assistant-automation-prompt-builder.test.ts test/assistant-automation-reply-event-path.test.ts`
- Passed: `pnpm typecheck`
- Passed: `bash scripts/workspace-verify.sh test:diff ...`
- Passed after final test-fixture edit: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-automation-support.test.ts`
- Passed after final test-fixture edit: `pnpm --dir packages/assistant-engine typecheck`
- Passed: `git diff --check`

You are worker 3 for the hosted hard-cut migration batch. You are not alone in
the codebase. Work carefully on top of the current tree, do not revert other
changes, and adjust to nearby edits instead of overwriting them.

Read first:

- `AGENTS.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-18-hosted-hard-cut-migration.md`
- `docs/hosted-hard-cut-migration-guide.md`

Goal:

- Push `apps/cloudflare` closer to the final thin-shim shape by removing
  remaining local queue/status ownership that can disagree with web-owned wake
  lifecycle state.

Write scope:

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/web-control-plane.ts`
- `apps/cloudflare/src/user-runner/{runner-queue-store,runner-queue-schema,runner-dispatch-processor,runner-scheduler,types}.ts`
- focused Cloudflare runner/control-plane tests

Do not touch unless strictly required:

- `apps/web/**`
- `packages/assistant-runtime/**`
- shared hosted-execution contract/vocabulary renames
- unrelated `apps/cloudflare` e2e harness work outside focused runner/control-plane tests

Context from the live tree:

- Cloudflare already fetches wake batches from web and commits cursor updates back
  to web.
- `user-runner.ts` still depends on `RunnerQueueStore` local queue/status tables
  (`pending_events`, `consumed_events`, `poisoned_events`) and local fallback
  dispatch status.
- The migration guide treats those tables as the remaining duplicate queue owner.

Implementation target:

- Reduce local queue truth further toward:
  - active run lease / run status
  - bundle-ref cache for warm reuse
  - next wake scheduling
- Prefer web-owned wake status and cursor state for pending/poisoned/completed
  truth.
- Delete or stop using local queue/status surfaces when safe.

Constraints:

- Preserve duplicate-executor safety and cursor-CAS behavior.
- Do not reintroduce staged dispatch payload control surfaces or new local queue
  ownership.
- Be careful around the active `apps/cloudflare` e2e stabilization lane already
  registered in the coordination ledger.

Verification:

- Run the highest-signal focused Cloudflare tests you touch, for example:
  - focused `apps/cloudflare/test/user-runner.test.ts`
  - focused `apps/cloudflare/test/web-control-plane.test.ts`
- If a broader Cloudflare verify command is practical, report it.

Final response format:

- summary of what changed
- exact files changed
- verification run and outcomes
- any blockers or follow-up risks

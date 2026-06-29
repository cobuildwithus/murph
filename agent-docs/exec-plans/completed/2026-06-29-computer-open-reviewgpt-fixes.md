Goal (incl. success criteria):
- Resolve accepted ReviewGPT findings for commit `d4697b2598` without re-expanding the hosted computer tool surface.
- Success means `computer_open` can reclaim completed or stale-checkpointed handoffs without poisoning the run, preserves awaiting handoff locks when browser observation fails, and retains the hard-cut model-visible tool contract.

Constraints/Assumptions:
- `apps/web` owns hosted computer-use run/handoff state and Kernel browser authority.
- `computer_open` is the single browser entry primitive; `computer_act` remains the bounded action primitive.
- Do not restore model-visible `computer_observe` or `computer_start_run`.
- Preserve unrelated homepage working-tree edits in the current checkout.

Key decisions:
- Accept the first two ReviewGPT findings as likely actionable pending code-path verification.
- Treat the old observe-route deploy-skew finding through the repo's existing hard-cut deployment concern unless code evidence shows a compatibility route is required.
- Prefer one internal acquire/open helper over layering new fallback branches on top of the old start-run path.

State:
- Ready to commit.

Done:
- Ran ReviewGPT on commit `d4697b2598` with a clean committed-tree snapshot and commit diff.
- ReviewGPT returned findings for stale-checkpoint reclaim ordering, lock clearing before browser observation, old observe-route deploy skew, and old start-run abstraction complexity.
- Verified the accepted findings against `ComputerUseService.openRun` and the hidden resume-proof plumbing.
- Split run acquisition from awaiting-run resume for `computer_open`.
- Changed awaiting `computer_open` reclaim to read the live browser before clearing the awaiting lock.
- Added exact `kernelSessionId` fencing to `markRunRunning` so a read from one Kernel session cannot unlock another.
- Added regressions for completed handoff read failure, stale checkpointing reclaim with hidden reply proof, stale checkpointing read failure, stale checkpointing session-swap race, and stale checkpointing without hidden reply proof.
- Ran completion audits: security/privacy found no issue; coverage found the stale-checkpoint read-failure gap and it was fixed; deep review found the session-swap race and it was fixed.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-execution-computer-use.test.ts` passed: 141 tests.
- `pnpm typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/computer-use/service.ts apps/web/src/lib/computer-use/store.ts apps/web/test/hosted-execution-computer-use.test.ts` ran the affected `apps/web verify` lane but failed on unrelated dirty homepage/config work: `apps/web/test/next-config.test.ts` and `apps/web/test/page.test.ts`.

Now:
- Commit the scoped hosted computer follow-up.

Next:
- Report verification and unrelated app-verifier failures.

Open questions (UNCONFIRMED if needed):
- None for the accepted fix scope. Deploy skew remains intentionally out of scope per user instruction.

Working set (files/ids/commands):
- apps/web/src/lib/computer-use/service.ts
- apps/web/src/lib/computer-use/store.ts
- apps/web/test/hosted-execution-computer-use.test.ts
- packages/assistant-engine/src/assistant-codex/dynamic-tools.ts
- packages/hosted-execution/src/computer-use.ts
- agent-docs/exec-plans/active/COORDINATION_LEDGER.md
- ReviewGPT thread: https://chatgpt.com/c/6a42a5c8-586c-83ea-8e76-a26031d345f4
Status: completed
Updated: 2026-06-29
Completed: 2026-06-29

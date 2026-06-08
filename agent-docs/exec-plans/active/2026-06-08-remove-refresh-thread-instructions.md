Goal (incl. success criteria):
- Remove `refreshThreadInstructions` and developer-instruction refresh plumbing from Codex thread resume.
- Success means resumed Codex turns no longer try to refresh developer instructions or dynamic tools; fresh thread starts still send current developer instructions and dynamic tools.

Constraints/Assumptions:
- Preserve unrelated dirty work in other worktrees and active plans.
- Keep the change narrowly scoped to Codex assistant thread planning/request construction and matching tests.
- Fingerprint changes will be handled by creating fresh Codex threads rather than mutating resumed threads.

Key decisions:
- Treat `thread/start` as the only Codex lifecycle point that receives updated Murph developer instructions and dynamic tools.
- Do not send `dynamicTools` on `thread/resume` because Codex resume does not consume that field.

State:
- Implementation complete; WIP PR requested while final verification/audits continue.

Done:
- Confirmed current Codex resume protocol has instruction overrides but no dynamic tools, while Murph now plans to avoid resume refreshes entirely.
- Removed the resume refresh flag from assistant-engine source, app-server request construction, diagnostics, and focused tests.
- Removed hosted structured-log extraction for the deleted diagnostic field.
- Passed focused assistant-engine and assistant-runtime tests.
- Passed `pnpm typecheck` after preparing fresh-worktree build artifacts.

Now:
- Finish `pnpm test:diff` and required completion audits.

Next:
- Push follow-up fixes if verification or audits find anything, then close the plan with a scoped final commit.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-engine/src/**`
- `packages/assistant-engine/test/**`
- `packages/assistant-runtime/src/hosted-runtime/events.ts`
- `packages/assistant-runtime/test/hosted-runtime-events.test.ts`

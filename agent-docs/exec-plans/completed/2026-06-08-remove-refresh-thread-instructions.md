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
- Implementation complete; verification and audits resolved.

Done:
- Confirmed current Codex resume protocol has instruction overrides but no dynamic tools, while Murph now plans to avoid resume refreshes entirely.
- Removed the resume refresh flag from assistant-engine source, app-server request construction, diagnostics, and focused tests.
- Removed hosted structured-log extraction for the deleted diagnostic field.
- Passed focused assistant-engine and assistant-runtime tests.
- Passed `pnpm typecheck` after preparing fresh-worktree build artifacts.
- Passed `pnpm test:diff` for changed files.
- Coverage audit found no missing proof.
- Task-finish audit found no code issues; accepted finding to close/archive this plan before merge.
- Security/privacy audit raised thread-context fingerprint enforcement as a medium concern; rejected for this PR as pre-existing/out of scope because resumed turns already did not refresh developer instructions (`refreshThreadInstructions` was false on resume) and Codex ignored resume `dynamicTools`. Fingerprint-mismatch fresh-thread routing remains the intended follow-up architecture.

Now:
- Close/archive this active plan and remove the ledger row.

Next:
- Push final plan-close commit to PR #65.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-engine/src/**`
- `packages/assistant-engine/test/**`
- `packages/assistant-runtime/src/hosted-runtime/events.ts`
- `packages/assistant-runtime/test/hosted-runtime-events.test.ts`
Status: completed
Updated: 2026-06-08
Completed: 2026-06-08

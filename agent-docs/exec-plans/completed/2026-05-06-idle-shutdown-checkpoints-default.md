# Idle Shutdown Checkpoints Default

Goal:
- Re-enable idle shutdown checkpoints by default in the Cloudflare Worker environment reader.
- Success means `readHostedExecutionWorkerEnvironment()` returns `idleShutdownCheckpointsEnabled: true` without relying on a hardcoded temporary false branch, and focused env tests cover the default.

Constraints/Assumptions:
- Keep the change scoped to `apps/cloudflare` env reading and tests.
- Preserve unrelated active worktree and ledger edits.
- Do not change runner alarm/checkpoint behavior beyond the env default.

Key decisions:
- Remove the temporary production hotfix hardcode and use a literal true default.
- Add direct test coverage at the env-reader boundary.

State:
- Completed and committed.

Done:
- Located the hardcoded value in `apps/cloudflare/src/hosted-execution-worker-env.ts`.
- Removed the temporary false hotfix and made the Worker env reader return `idleShutdownCheckpointsEnabled: true`.
- Added a direct env-reader regression test for the default.
- Ran focused env-reader Vitest successfully.
- Ran focused idle-shutdown runner checkpoint cleanup proof successfully.
- Completed security/privacy, coverage, and final-review audit passes.

Now:
- Completed.

Next:
- None.

Open questions:
- None.

Working set:
- `apps/cloudflare/src/hosted-execution-worker-env.ts`
- `apps/cloudflare/test/env.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-05-07
Completed: 2026-05-07

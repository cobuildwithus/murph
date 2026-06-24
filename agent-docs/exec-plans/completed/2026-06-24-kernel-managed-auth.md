Goal (incl. success criteria):
- Land the supplied Kernel Managed Auth implementation patch on an isolated branch.
- Preserve Live View login while adding agent-selectable managed login, durable Kernel profile/domain connections, idempotent controller/callback behavior, account-deletion cleanup, and focused tests/docs.
- Success means the patch applies cleanly, the diff is reviewed for scope/privacy, focused and required verification passes run or are explicitly reported, and a draft PR is opened from the task branch.

Constraints/Assumptions:
- Treat the patcher as behavioral intent, not overwrite authority; inspect the resulting diff before committing.
- No new Prisma migration, database table, dependency, environment variable, worker, webhook, polling system, or broad provider abstraction unless the applied diff already proves the need.
- Keep Kernel API credentials and live-view capabilities web-owned and hidden from runner env, prompts, logs, docs, fixtures, and user-facing output.
- Preserve unrelated active ledger rows and do not modify the main checkout.

Key decisions:
- Branch from current `origin/main` so unrelated local `main` commits are not included.
- Use a full active execution plan because the change touches auth/session behavior, public routes, persisted connection state, deletion, tests, and durable docs.

State:
- In progress.

Done:
- Created isolated worktree and branch from `origin/main`.
- Confirmed the supplied patcher exists and compiles under `python3`.

Now:
- Apply the patcher and inspect the resulting diff.

Next:
- Run focused verification, required audits, scoped final review, commit through the plan workflow, push, and open a draft PR.

Open questions (UNCONFIRMED if needed):
- Whether the supplied patch still matches the latest `origin/main` anchors is UNCONFIRMED until the patcher runs in this worktree.

Working set (files/ids/commands):
- apps/web hosted computer-use routes, services, tests, and docs touched by the patcher.
- packages/assistant-engine computer-use skill/tool surfaces touched by the patcher.
- docs and agent-docs security, architecture, privacy, and deletion docs touched by the patcher.
- `python3 <patcher> --repo .`
- Focused Vitest commands supplied with the patch, `pnpm --dir apps/web typecheck`, and `pnpm test:diff`.
Status: completed
Updated: 2026-06-24
Completed: 2026-06-24

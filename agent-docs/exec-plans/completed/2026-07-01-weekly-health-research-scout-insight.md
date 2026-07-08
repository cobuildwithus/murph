Goal (incl. success criteria):
- Land the weekly health research-scout insight patch on `main` and push it to `origin/main`.
- Success means the patch applies cleanly, the changed research-scout request shape and managed-automation behavior are reviewed, focused verification passes, the plan is closed with a scoped commit, and `main` is pushed.

Constraints/Assumptions:
- Preserve unrelated active ledger rows and working-tree edits.
- Keep the change limited to the supplied code/test patch unless verification proves a minimal follow-up fix is required.
- Do not write local machine paths or personal identifiers into repo files, commit text, or handoff notes.
- User explicitly requested landing on `main`, so use the current checkout rather than a separate worktree or PR lane.

Key decisions:
- Treat this as a standard repo code/test change across `assistant-engine`, `contracts`, and `cli`.
- Use scoped verification for the touched owners: `pnpm typecheck` plus `pnpm test:diff` for the changed files.

State:
- Verification passed; final review in progress.

Done:
- Confirmed `main` is clean and up to date with `origin/main`.
- Checked that the supplied patch applies cleanly.
- Read the required repo workflow, verification, architecture, product, security, and testing docs.
- Applied the supplied patch.
- Ran `pnpm typecheck`.
- Ran `pnpm test:diff packages/assistant-engine/src/assistant/managed-automations.ts packages/assistant-engine/test/managed-automations.test.ts packages/assistant-engine/test/managed-automations-core.test.ts packages/contracts/src/exa-research-scout.ts packages/contracts/test/exa-research-scout.test.ts packages/cli/test/research-scout.test.ts`.
- Ran `pnpm test:smoke`.
- Ran local prompt-focused review against repo prompt-review guidance and current OpenAI prompt guidance; no blocking issues found.

Now:
- Run final diff review and close the plan with a scoped commit.

Next:
- Push `main`.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-engine/src/assistant/managed-automations.ts
- packages/assistant-engine/test/managed-automations.test.ts
- packages/assistant-engine/test/managed-automations-core.test.ts
- packages/contracts/src/exa-research-scout.ts
- packages/contracts/test/exa-research-scout.test.ts
- packages/cli/test/research-scout.test.ts
- pnpm typecheck
- pnpm test:diff packages/assistant-engine/src/assistant/managed-automations.ts packages/assistant-engine/test/managed-automations.test.ts packages/assistant-engine/test/managed-automations-core.test.ts packages/contracts/src/exa-research-scout.ts packages/contracts/test/exa-research-scout.test.ts packages/cli/test/research-scout.test.ts
Status: completed
Updated: 2026-07-01
Completed: 2026-07-01

Goal (incl. success criteria):
- Make conversation-bound assistant turns stop reusing a stale Codex-home session after the operator changes the saved assistant backend.
- Success: a channel auto-reply / conversation-key lookup creates a fresh session when the requested provider continuity target changes, while explicit session-id or alias resumes stay pinned to their original target.

Constraints/Assumptions:
- Preserve explicit assistant session resume semantics and provider-native continuity for unchanged targets.
- Do not log or fixture real Codex homes, contact identifiers, local usernames, secrets, or raw provider payloads.
- Work only in the current checkout and preserve unrelated active worktree edits.

Key decisions:
- Treat default-backend continuity drift the same way as session age rollover for conversation-key lookup only.
- Keep explicit session-id and alias lookups stable, since those are deliberate resume handles.

State:
- Completed; scoped commit blocked by overlapping shared ledger edits.

Done:
- Traced saved defaults through session resolution, turn route selection, and Codex app-server launch.
- Added conversation-key continuity refresh while preserving explicit session-id and alias resumes.
- Added regression coverage for Codex-home continuity refresh.
- Focused assistant-state, assistant-store-runtime, package typechecks, `test:smoke`, and scoped `test:diff` package tests passed up to unrelated Health Commons generated-content blockers.
- Required `security-privacy-review`, `coverage-write`, and `task-finish-review` passes completed. No findings from security or final review; coverage pass added one no-target lookup assertion.
- `pnpm typecheck` and the path-scoped `test:diff` lane remain blocked only by unrelated active Health Commons content/generator issues outside this task.

Now:
- Closed with the repo helper.

Next:
- Retry a scoped commit only after unrelated shared ledger edits are resolved, or commit the code/test files separately if the user explicitly accepts leaving the plan closure uncommitted.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-engine/src/assistant/store.ts`
- `packages/assistant-engine/src/assistant/store/persistence.ts`
- `packages/cli/test/assistant-state.test.ts`
- `agent-docs/exec-plans/active/2026-04-26-codex-home-session-refresh.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `pnpm --dir packages/cli exec vitest run test/assistant-state.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-store-runtime.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/cli typecheck`
- `pnpm test:smoke`
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/store.ts packages/assistant-engine/src/assistant/store/persistence.ts packages/cli/test/assistant-state.test.ts`
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26

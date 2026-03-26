You are Codex Worker R5 operating in the current shared worktree. Do not create a commit.

Before any code changes:
- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Add your own row as `Codex Worker R5` with this lane's files/symbols and mark it `in_progress`.
- Keep this patch to Codex adapter files/tests only.

After changes:
- Run the narrowest relevant tests you touch.
- Remove your ledger row before finishing.
- Final response: summary, files changed, tests run, blockers.

Task:

Clean up misleading Codex adapter abstractions around config parsing and final-message fallback without changing behavior except where a targeted test proves the intended contract.

Relevant files/symbols:
- `packages/cli/src/assistant-codex.ts`
  - `resolveCodexDisplayOptions`
  - `parseCodexDisplayConfig`
  - `CodexDisplayConfig`
  - `readOptionalTextFile`
  - `executeCodexPrompt`
- Regression anchors:
  - `packages/cli/test/assistant-codex.test.ts`

Best-guess fix:
1. Decide explicitly whether top-level `profile = ...` matters; either wire it into `resolveCodexDisplayOptions(...)` or remove the unused parsed field.
2. Rename `readOptionalTextFile(...)` or change its contract so the empty-file fallback behavior is explicit and well tested.
3. Add focused coverage for the chosen `profile = ...` behavior and the empty `last-message.txt` fallback case.

Guardrails:
- Keep the patch tightly scoped to the Codex adapter surface.
- Preserve current parsed-event/session-id/fallback semantics aside from making the empty-file/profile behavior explicit.

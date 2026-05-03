Goal (incl. success criteria):
- Restore the older explicit assistant onboarding CLI/contracts surface from pre-429796294.
- Success means contracts expose the restored onboarding schemas/types and CLI exposes `assistant onboarding status`, `assistant onboarding complete --reason ...`, and `assistant onboarding reopen`.

Constraints/Assumptions:
- Implementation ownership is limited to:
  - `packages/operator-config/src/assistant-cli-contracts.ts`
  - `packages/assistant-cli/src/commands/assistant.ts`
  - `packages/cli/src/incur.generated.ts`
  - `packages/assistant-cli/test/assistant-command-coverage.test.ts` if command coverage requires it
- Preserve unrelated working-tree edits.
- Do not touch assistant-engine turn planning or system prompt.
- Completion reasons are limited to `user_answered`, `user_declined`, and `manual`.

Key decisions:
- Use `git show 429796294^:<path>` as the old baseline and adapt to current imports/style.

State:
- Active.

Done:
- Read repo routing, verification, architecture, and product docs.
- Confirmed no current dirty edits in owned files.
- Restored onboarding contracts, command handlers, generated command declarations, and command coverage test assertions.

Now:
- Run focused verification and fix any issues.

Next:
- Run completion review and commit scoped changes if verification passes.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `git show 429796294^:<path>`
- `pnpm typecheck`
- `pnpm test:diff <owned paths>`

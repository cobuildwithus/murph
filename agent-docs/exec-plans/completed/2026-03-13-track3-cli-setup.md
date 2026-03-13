Goal (incl. success criteria):
- Land Track 3 in the current repo shape: add parser-toolchain inbox CLI operations plus a one-command local setup flow.
- Success means `vault-cli inbox setup|parse|requeue` exist, `inbox doctor` reports parser-toolchain status without regressing existing inbox runtime checks, and root `pnpm setup:inbox -- --vault <path>` works through a repo-owned script.

Constraints/Assumptions:
- Preserve existing inbox CLI semantics and active adjacent work, especially the current connector/runtime doctor surface.
- Do not revert unrelated dirty worktree edits.
- The follow-up patch targets an older CLI service layout, so port behavior into the current `inbox-services.ts` + usecase-based CLI structure instead of applying it verbatim.
- Parser toolchain helpers may need to land here because the current tree lacks the discovery/config APIs assumed by Track 3.

Key decisions:
- Extend the existing inbox command group instead of replacing it.
- Keep `inbox doctor` backward-compatible by adding parser-toolchain reporting additively.
- Add parser toolchain config/discovery inside `@healthybob/parsers` and consume it from CLI inbox services.

State:
- done

Done:
- Read required repo/process docs and inspected the supplied Track 3 patch plus current CLI/parser architecture.
- Claimed scope in `COORDINATION_LEDGER.md`.

Now:
- None.

Next:
- Coordinate any follow-up docs landing if the active docs lane wants the new command surface reflected in README/contracts text this turn.
- Clear the unrelated `packages/cli/src/commands/health-command-factory.ts` type errors so repo-level verification can go green again.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether any other lane will concurrently extend `packages/cli/src/commands/inbox.ts` before this lands. Merge carefully on the current file state.

Working set (files/ids/commands):
- Files: `packages/cli/src/commands/inbox.ts`, `packages/cli/src/inbox-cli-contracts.ts`, `packages/cli/src/inbox-services.ts`, `packages/parsers/src/**`, `package.json`, `packages/cli/package.json`, `packages/cli/tsconfig.json`, `scripts/setup-inbox-local.sh`, CLI tests.
- Inputs: follow-up Track 3 patch, follow-up landing plan, follow-up validation notes.
- Verification targets: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
Status: completed
Updated: 2026-03-13
Completed: 2026-03-13

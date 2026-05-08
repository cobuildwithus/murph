Goal (incl. success criteria):
- Fix the five reviewed DeepSec BUG findings with minimal, durable boundary changes.
- Success means each real issue has a focused regression and the touched packages typecheck.

Constraints/Assumptions:
- Preserve unrelated dirty worktree changes.
- Keep changes narrow: validate malformed input, avoid setup-owned connector overreach, restore query id parity, normalize CSV duration text, and guard direct script execution.
- No new dependencies.

Key decisions:
- Use the simplest local fixes unless the existing owner API already provides a clean source of truth.

State:
- Completed.

Done:
- Reviewed the five findings and confirmed they are worth fixing.
- Applied narrow fixes and focused regression coverage for all five findings.
- Marked the matching DeepSec findings as fixed.
- Ran focused tests and typecheck; full diff tests are blocked by an unrelated assistant-engine parse error.

Now:
- None.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/query/src/scheduled-logs.ts`
- `packages/setup-cli/src/setup-services/channels.ts`
- `packages/vault-usecases/src/query-id-families.ts`
- `packages/vault-usecases/src/usecases/workout-import.ts`
- `scripts/check-hosted-run-stale-residue.ts`
- focused tests in matching packages
- `pnpm typecheck`
- `pnpm test:diff` (blocked by unrelated `packages/assistant-engine/test/assistant-input-store.test.ts` parse error)
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09

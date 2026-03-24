Goal (incl. success criteria):
- Audit every remaining place where `DEVICE_SYNC_SECRET` is treated as a control-token alias, then determine whether a strictly behavior-preserving simplification is possible.
- Success means the final state either lands only safe cleanup that preserves runtime behavior exactly, or leaves code untouched and reports precisely why removing the alias would be externally visible.

Constraints/Assumptions:
- This is report-first. Do not apply a breaking cleanup.
- Preserve current `DEVICE_SYNC_CONTROL_TOKEN > DEVICE_SYNC_SECRET` precedence everywhere.
- Preserve the current managed-daemon bootstrap behavior unless tests prove a change is externally invisible.
- Keep the cleanup narrow: centralize duplicated env constants/helpers and clarify compatibility intent in code/docs.

Key decisions:
- Treat alias removal as out of scope unless the audit proves no external caller relies on it.
- Prefer centralizing constants in `@healthybob/runtime-state` because both CLI and daemon already depend on that package.
- Add only focused regression coverage/documentation around the compatibility path rather than broad device-sync refactors.

State:
- completed with unrelated repo verification failures still open in other lanes

Done:
- Read the current runtime-state resolver, daemon config loader, managed-daemon env builder, README/docs, and the existing CLI/web/device-sync tests.
- Confirmed the compatibility path is already codified in runtime-state tests, daemon config tests, CLI managed-daemon tests, README text, and the verification docs.
- Audited every remaining alias site:
  - `packages/runtime-state/src/device-sync.ts` resolves `DEVICE_SYNC_CONTROL_TOKEN` first, then falls back to `DEVICE_SYNC_SECRET`.
  - `packages/device-syncd/src/config.ts` requires `DEVICE_SYNC_SECRET` and falls back to it when `DEVICE_SYNC_CONTROL_TOKEN` is unset.
  - `packages/cli/src/device-daemon/paths.ts` writes the managed daemon env so `DEVICE_SYNC_CONTROL_TOKEN` is always set and `DEVICE_SYNC_SECRET` mirrors it unless the operator already supplied a distinct secret.
  - `packages/device-syncd/README.md`, `packages/web/README.md`, `packages/runtime-state/test/ulid.test.ts`, `packages/device-syncd/test/config.test.ts`, and `packages/cli/test/device-daemon.test.ts` all document or assert the alias contract.
- Landed the safe cleanup only: centralized the shared secret/control-token env constants in `@healthybob/runtime-state`, rewired daemon config and managed-daemon env shaping to use those shared exports, and added comments/README wording that make the compatibility alias explicit.
- Added focused regression coverage for `DEVICE_SYNC_CONTROL_TOKEN > DEVICE_SYNC_SECRET` precedence in the shared resolver and for preserving a distinct `DEVICE_SYNC_SECRET` when the managed daemon also gets an explicit `DEVICE_SYNC_CONTROL_TOKEN`.
- Verified `pnpm exec vitest run --no-coverage packages/runtime-state/test/ulid.test.ts packages/device-syncd/test/config.test.ts packages/cli/test/device-daemon.test.ts packages/cli/test/device-sync-client.test.ts --maxWorkers 1` passes.
- Verified `pnpm --dir ../.. exec vitest run --config packages/web/vitest.config.ts --no-coverage packages/web/test/device-sync-lib.test.ts --maxWorkers 1` passes from `packages/web`.
- Ran `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`; all failed for unrelated pre-existing worktree issues in `packages/core/src/bank/providers.ts`, plus existing Linq/setup compile failures in `packages/cli/src/inbox-services/connectors.ts` and `packages/cli/src/setup-wizard.ts`.

Now:
- None.

Next:
- Keep the unrelated core/Linq/setup verification failures in their existing lanes; no further change is required for this behavior-preserving device-sync auth alias cleanup.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/2026-03-24-device-sync-auth-alias-audit.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `packages/runtime-state/src/device-sync.ts`
- `packages/device-syncd/src/config.ts`
- `packages/cli/src/device-daemon/{paths,types}.ts`
- `packages/device-syncd/README.md`
- `packages/runtime-state/test/ulid.test.ts`
- `packages/device-syncd/test/config.test.ts`
- `packages/cli/test/device-daemon.test.ts`
- `packages/cli/test/device-sync-client.test.ts`
- `packages/web/test/device-sync-lib.test.ts`
Status: completed
Updated: 2026-03-24
Completed: 2026-03-24

Goal (incl. success criteria):
- Keep installed `healthybob` and `vault-cli` shims usable when a local workspace package `dist/index.js` is temporarily missing during or after a package rebuild.
- Success means the generated shim rebuilds missing local runtime package outputs before launching the built CLI, focused CLI tests pass, and the local shell launcher can recover from a missing runtime package build.

Constraints/Assumptions:
- Preserve the built CLI path as the normal first-choice execution path.
- Limit shim self-heal work to local workspace package build outputs that the CLI depends on.
- Workspace-wide typecheck/test failures may remain if they are unrelated pre-existing package/build issues.

Key decisions:
- Repair the generated shell shim in `packages/cli/src/setup-services/shell.ts` instead of changing CLI runtime imports.
- Add focused setup-shim coverage in `packages/cli/test/setup-cli.test.ts`.
- Patch the currently installed local shims separately from the repo commit so the user can recover immediately.

State:
- completed

Done:
- Diagnosed `ERR_MODULE_NOT_FOUND` failures as missing workspace package `dist` outputs behind the installed shell shim.
- Updated generated shim logic to rebuild missing runtime package outputs before launching the built CLI.
- Added focused shim behavior coverage plus existing inbox coverage reruns.
- Patched the currently installed local `healthybob` and `vault-cli` shims with the same self-heal logic.

Now:
- Verification complete; broad workspace failures remain unrelated to this shim repair.
- Commit the repo files for the shim repair.

Next:
- Move or close this execution plan if the repo workflow requires it after handoff.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether the generated shim should eventually rebuild only the exact missing dependency closure instead of the fixed direct runtime package set.

Working set (files/ids/commands):
- `packages/cli/src/setup-services/shell.ts`
- `packages/cli/test/setup-cli.test.ts`
- `packages/cli/test/inbox-cli.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-03-23-cli-shim-runtime-repair.md`
- `pnpm exec vitest run packages/cli/test/setup-cli.test.ts packages/cli/test/inbox-cli.test.ts --no-coverage --maxWorkers 1`
- `healthybob run --once`

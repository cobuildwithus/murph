Goal (incl. success criteria):
- Hard-cut CLI vault selection out of per-command options.
- Commands that need a vault receive it from one execution-context boundary instead of duplicated command registries or user-visible `--vault` schemas.
- Reproduce the measurement/default-vault bug and fix the same class across CLI commands.

Constraints/Assumptions:
- Preserve unrelated dirty working-tree edits.
- Do not expose local paths, usernames, personal identifiers, secrets, or vault contents in docs, tests, logs, or final output.
- Prefer a central adapter over touching every command handler.
- Raw `vault-cli` may keep a boundary override for automation; `murph` should use the active configured vault for normal commands.

Key decisions:
- Remove command-name vault injection registries as the long-term architecture.
- Keep existing command handlers initially by injecting vault into handler context centrally.
- Treat note parsing as a separate nearby CLI bug only if it can be fixed with an existing shared helper.

State:
- Complete; ready to archive.

Done:
- Reproduced the missing default vault behavior for measurement and other omitted command groups.
- Identified stale/missing registry entries as the brittle class of bugs to remove.
- Removed the command-name vault injection registry and moved vault selection to one CLI execution-context adapter.
- Hid command-level `vault` schemas/help/LLM manifests while preserving handler compatibility through central context injection.
- Kept raw `vault-cli --vault` as a boundary override and made `murph` normal commands use the active configured vault.
- Fixed measurement and scheduled-log prose notes to accept commas through the existing repeatable text helper.
- Hardened the context adapter with invocation-scoped vault state for overlapping in-process calls and fetch transport requests.
- Added regression coverage for schema hiding, missing-vault behavior, boundary overrides, fetch transport injection, concurrent serve isolation, and comma prose notes.
- Ran required verification/audits:
  - `git diff --check` passed.
  - `pnpm --dir packages/cli typecheck` passed.
  - `pnpm --dir packages/cli test:source` passed.
  - `pnpm --dir packages/operator-config typecheck` passed.
  - `pnpm --dir packages/operator-config test` passed.
  - `pnpm typecheck` passed.
  - `pnpm test:diff` passed for `packages/cli`.
  - simplify, security/privacy, coverage-write, and task-finish audit passes completed; medium findings were fixed.

Now:
- Archive plan and create the scoped follow-up commit.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- Low-priority follow-up: removing stale source-level example `vault` entries would let us delete the runtime example-stripper, but that is broad mechanical cleanup and not required for the hard-cut invariant.

Working set (files/ids/commands):
- `packages/cli/src/vault-cli.ts`
- `packages/cli/src/cli-entry.ts`
- `packages/cli/src/vault-cli-vault-context.ts`
- `packages/operator-config/src/operator-config/cli-vault-defaults.ts`
- `packages/operator-config/src/operator-config.ts`
- `packages/cli/test/**`
- `packages/operator-config/test/**`
Status: completed
Updated: 2026-05-21
Completed: 2026-05-21

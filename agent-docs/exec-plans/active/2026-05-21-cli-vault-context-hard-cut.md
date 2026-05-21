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
- Active.

Done:
- Reproduced the missing default vault behavior for measurement and other omitted command groups.
- Identified stale/missing registry entries as the brittle class of bugs to remove.

Now:
- Implement the central vault execution-context adapter and simplify entrypoint vault resolution.

Next:
- Update tests and generated CLI schemas.
- Run package verification, repo typecheck, privacy checks, and required completion audits.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED until implementation: exact generated schema/test churn from removing user-visible command-level vault options.

Working set (files/ids/commands):
- `packages/cli/src/vault-cli.ts`
- `packages/cli/src/cli-entry.ts`
- `packages/cli/src/vault-cli-vault-context.ts`
- `packages/operator-config/src/operator-config/cli-vault-defaults.ts`
- `packages/operator-config/src/operator-config.ts`
- `packages/cli/test/**`
- `packages/operator-config/test/**`

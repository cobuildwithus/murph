Package owner: `@murphai/inboxd`
Lane: telegram + persist coverage

You own only these files in `packages/inboxd/**`:
- `src/connectors/telegram/connector.ts`
- `src/indexing/persist.ts`
- package-local tests that primarily cover those files

You are not alone in the codebase. Preserve unrelated edits. Do not edit root/shared config, other packages, plan files, or commit.

Goal

- Raise the owned files above the shared root coverage gate while keeping `packages/inboxd/vitest.config.ts` on the shared default helper with no lower override.

Current failing files/metrics from the latest full package run

- `src/connectors/telegram/connector.ts`: lines `75.13`, statements `75.13`, branches `66.87`
- `src/indexing/persist.ts`: lines `84.55`, statements `84.73`, branches `71.91`

Constraints

- Do not edit `vitest.config.ts`.
- Favor deterministic tests using existing connector/runtime/indexing helpers.
- Use normal `pnpm` commands for package-local verification. If `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` appears, report the blocker instead of bypassing it.

Required output

- Make the package-local changes in your owned files.
- Report exact commands run, resulting coverage evidence, and changed files.

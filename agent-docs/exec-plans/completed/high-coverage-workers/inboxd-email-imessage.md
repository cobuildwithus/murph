Package owner: `@murphai/inboxd`
Lane: email + imessage coverage

You own only these files in `packages/inboxd/**`:
- `src/connectors/email/connector.ts`
- `src/connectors/email/normalize.ts`
- `src/connectors/email/normalize-parsed.ts`
- `src/connectors/email/parsed.ts`
- `src/connectors/imessage/connector.ts`
- package-local tests that primarily cover those files

You are not alone in the codebase. Preserve unrelated edits. Do not edit root/shared config, other packages, plan files, or commit.

Goal

- Raise the owned files above the shared root coverage gate while keeping `packages/inboxd/vitest.config.ts` on the shared default helper with no lower override.

Current failing files/metrics from the latest full package run

- `src/connectors/email/normalize-parsed.ts`: branches `71.66`
- `src/connectors/email/connector.ts`: functions `80.95`, branches `72.6`
- `src/connectors/email/normalize.ts`: branches `75.3`
- `src/connectors/email/parsed.ts`: branches `76.5`
- `src/connectors/imessage/connector.ts`: lines `83.7`, statements `83.82`, branches `73.94`

Constraints

- Do not edit `vitest.config.ts`.
- Favor deterministic tests using existing connector helpers and payload factories.
- Use normal `pnpm` commands for package-local verification. If `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` appears, report the blocker instead of bypassing it.

Required output

- Make the package-local changes in your owned files.
- Report exact commands run, resulting coverage evidence, and changed files.

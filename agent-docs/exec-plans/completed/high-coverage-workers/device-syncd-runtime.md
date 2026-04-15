Package owner: `@murphai/device-syncd`
Lane: runtime/http/store coverage

You own only these files in `packages/device-syncd/**`:
- `src/http.ts`
- `src/service.ts`
- `src/store.ts`
- `src/public-ingress.ts`
- package-local tests that primarily cover those files:
  - `test/http.test.ts`
  - `test/service.test.ts`
  - `test/store.test.ts`
  - `test/public-ingress.test.ts`

You are not alone in the codebase. Preserve unrelated edits. Do not edit root/shared config, other packages, plan files, or commit.

Goal

- Raise the owned files above the shared root coverage gate while keeping `packages/device-syncd/vitest.config.ts` on the shared default helper with no lower override.

Current failing files/metrics from the latest full package run

- `src/http.ts`: branches `73.77`
- `src/service.ts`: lines `67.47`, functions `83.33`, statements `67.46`, branches `62.22`
- `src/store.ts`: branches `63.23`
- `src/public-ingress.ts`: functions `83.33`

Constraints

- Do not edit `vitest.config.ts`.
- Preserve the current HTTP handler seam and listener-wiring regression test.
- Favor deterministic tests and reuse the existing helpers.
- Use normal `pnpm` commands for package-local verification. If `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` appears, report the blocker instead of bypassing it.

Required output

- Make the package-local changes in your owned files.
- Report exact commands run, resulting coverage evidence, and changed files.

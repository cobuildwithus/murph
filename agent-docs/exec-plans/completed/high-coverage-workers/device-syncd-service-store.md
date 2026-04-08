Package owner: `@murphai/device-syncd`
Lane: service/store coverage

You own only these files in `packages/device-syncd/**`:
- `src/service.ts`
- `src/store.ts`
- package-local tests that primarily cover those files:
  - `test/service.test.ts`
  - `test/store.test.ts`

You are not alone in the codebase. Preserve unrelated edits. Do not edit provider files, HTTP/public-ingress files, root/shared config, other packages, plan files, or commit.

Goal

- Raise the owned files above the shared root coverage gate while keeping `packages/device-syncd/vitest.config.ts` on the shared default helper with no lower override.
- Reuse the existing in-flight tests already present in the tree and make the smallest honest additions or fixes needed.

Current context

- The package already has in-flight service/store test work in the shared tree.
- The package still lacks a clean whole-package `test:coverage` proof.

Constraints

- Do not edit `vitest.config.ts`.
- Favor deterministic tests and reuse the existing helpers.
- Use normal `pnpm` commands for package-local verification. If `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` appears, report the blocker instead of bypassing it.
- Prefer test changes over behavior changes.

Required output

- Make the package-local changes in your owned files.
- Report exact commands run, resulting coverage evidence, and changed files.
- State clearly whether service/store still block whole-package coverage.

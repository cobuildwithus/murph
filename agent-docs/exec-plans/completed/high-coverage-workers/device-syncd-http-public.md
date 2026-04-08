Package owner: `@murphai/device-syncd`
Lane: http/public-ingress coverage

You own only these files in `packages/device-syncd/**`:
- `src/http.ts`
- `src/public-ingress.ts`
- package-local tests that primarily cover those files:
  - `test/http.test.ts`
  - `test/public-ingress.test.ts`

You are not alone in the codebase. Preserve unrelated edits. Do not edit provider files, service/store files, root/shared config, other packages, plan files, or commit.

Goal

- Raise the owned files above the shared root coverage gate while keeping `packages/device-syncd/vitest.config.ts` unchanged.
- Reuse the existing in-flight HTTP/public-ingress tests already present in the tree.

Current context

- The package already has in-flight `http.test.ts` and `public-ingress.test.ts` work in the shared tree.
- `test/http.test.ts` currently includes a real-listener case (`device sync http server can start without a public listener and rejects missing control tokens`) that has produced `listen EPERM` in this environment during full-package coverage.
- The package still lacks a clean whole-package `test:coverage` proof.

Constraints

- Do not edit `vitest.config.ts`.
- Preserve the current HTTP handler seam and listener-wiring regression intent.
- Favor deterministic tests and small behavior-preserving changes only when tests alone cannot honestly cover the seam.
- Use normal `pnpm` commands for package-local verification. If `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` appears, report the blocker instead of bypassing it.

Required output

- Make the package-local changes in your owned files.
- Report exact commands run, resulting coverage evidence, and changed files.
- State clearly whether HTTP/public-ingress still block whole-package coverage.

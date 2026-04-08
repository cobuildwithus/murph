Relaunching the remaining `device-syncd` provider lane after prior agent interruption. You own only these files in `packages/device-syncd/**` for this lane:
- `packages/device-syncd/src/providers/garmin.ts`
- `packages/device-syncd/src/providers/oura.ts`
- `packages/device-syncd/src/providers/oura-webhooks.ts`
- `packages/device-syncd/src/providers/shared-oauth.ts`
- `packages/device-syncd/src/providers/whoop.ts`
- package-local tests that primarily cover those files, especially:
  - `packages/device-syncd/test/garmin-provider.test.ts`
  - `packages/device-syncd/test/oura-provider.test.ts`
  - `packages/device-syncd/test/oura-webhooks.test.ts`
  - `packages/device-syncd/test/whoop-provider.test.ts`
  - `packages/device-syncd/test/public-ingress.test.ts`
  - `packages/device-syncd/test/shared-oauth.test.ts`
  - `packages/device-syncd/test/http.test.ts` only if strictly needed for provider/webhook/shared-oauth coverage and without overlapping the already-landed non-provider intent

You are not alone in the codebase. Preserve unrelated edits and do not revert others' work. Adjust around the current live tree, which already contains in-flight provider-side edits.

Goal: get the remaining `device-syncd` provider-related files above the shared root per-file gate (`85 lines / 85 functions / 80 branches / 85 statements`) while keeping `packages/device-syncd/vitest.config.ts` on the shared default helper with no lower override.

Fresh failing provider files/metrics from a full package run:
- `src/providers/shared-oauth.ts`: branches 74.28
- `src/providers/oura-webhooks.ts`: lines 81.02, functions 80, statements 80.8, branches 62.58
- `src/providers/garmin.ts`: functions 82.35, statements 84.48, branches 79.54
- `src/providers/whoop.ts`: lines 83.04, statements 82.75, branches 64.88
- `src/providers/oura.ts`: functions 84.28, branches 69.68

Additional context:
- Non-provider owned files are already in range from another lane (`http.ts`, `service.ts`, `store.ts`, `public-ingress.ts`). Avoid broad edits outside your owned slice.
- The package full run can take a long time here but did flush a usable result once.

Constraints:
- Do not edit root/shared config or other packages.
- Favor deterministic tests and small package-local seams; do not add a new harness stack.
- Run package-local verification with normal `pnpm` commands. If `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` appears, report the blocker instead of bypassing it.

Required output:
- Make the package-local changes in your owned files.
- Report exact commands run, resulting coverage evidence, and changed files.

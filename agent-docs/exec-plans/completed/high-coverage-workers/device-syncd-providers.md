You own only these files in `packages/device-syncd/**` for this lane:
- `packages/device-syncd/src/providers/garmin.ts`
- `packages/device-syncd/src/providers/oura.ts`
- `packages/device-syncd/src/providers/oura-webhooks.ts`
- `packages/device-syncd/src/providers/shared-oauth.ts`
- `packages/device-syncd/src/providers/whoop.ts`
- package-local tests that primarily cover those files, especially:
  - `packages/device-syncd/test/garmin-provider.test.ts`
  - `packages/device-syncd/test/oura-provider.test.ts`
  - `packages/device-syncd/test/whoop-provider.test.ts`
  - `packages/device-syncd/test/public-ingress.test.ts`
  - `packages/device-syncd/test/http.test.ts` only if strictly needed for provider/webhook/shared-oauth coverage and without overlapping the service/http worker’s ownership intent

You are not alone in the codebase. Do not revert others' edits. Adjust around existing in-flight changes.

Goal: get the remaining `device-syncd` provider-related files above the shared root coverage gate (`85 lines / 85 functions / 80 branches / 85 statements`) while keeping `packages/device-syncd/vitest.config.ts` on the shared default helper with no lower override.

Current failing files/metrics from a fresh full run:
- `src/providers/shared-oauth.ts`: branches 74.28
- `src/providers/oura-webhooks.ts`: lines 81.02, functions 80, statements 80.8, branches 62.58
- `src/providers/garmin.ts`: functions 82.35, statements 84.48, branches 79.54
- `src/providers/whoop.ts`: lines 83.04, statements 82.75, branches 64.88
- `src/providers/oura.ts`: functions 84.28, branches 69.68
- `src/public-ingress.ts`: functions 83.33

Constraints:
- Do not edit root/shared config or other packages.
- Preserve the new shared-threshold-helper alignment already present in `vitest.config.ts`.
- Favor deterministic tests and small package-local seams; do not add a new harness stack.
- Run package-local verification with normal `pnpm` commands. If `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` appears, report the blocker instead of bypassing it.

Required output:
- Make the package-local changes in your owned files.
- Report exact commands run, resulting coverage evidence, and changed files.

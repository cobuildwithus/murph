# PR 328 ReviewGPT Round 2

## Goal

Resolve the accepted ReviewGPT round-2 release-validator finding: SDK packages used only through `import type` must not be runtime dependencies of private packages bundled into the public CLI release.

Success criteria:

- `openai@6.45.0` and `@linqapp/sdk@0.28.0` remain exact-pinned where their types are used.
- Type-only SDK pins live in `devDependencies`, not runtime `dependencies`.
- CLI release target validation passes.
- Focused typechecks/tests and dependency checks are rerun.
- Commit, push, and ReviewGPT round 3 completes.

## Constraints/Assumptions

- Keep all runtime transport and credential boundaries unchanged.
- Do not add these SDKs to public CLI runtime dependencies unless a runtime import is proven.
- Keep ReviewGPT artifacts under `audit-packages/` local and uncommitted.

## Work Plan

1. Move exact SDK pins from runtime dependencies to devDependencies.
2. Regenerate/clean lockfile and verify release target.
3. Rerun focused tests/typechecks and dependency gates.
4. Commit, push, and run ReviewGPT round 3 on the pushed PR head.

## Verification

- PASS: `node scripts/verify-release-target.mjs --json`
- PASS: `pnpm install --lockfile-only --frozen-lockfile`
- PASS: `pnpm --filter @murphai/operator-config build`
- PASS: `pnpm --filter @murphai/exercise-library build`
- PASS: `pnpm --filter @murphai/assistant-engine build`
- PASS: emitted JS scan found no `openai` or `@linqapp/sdk` runtime imports in `packages/assistant-engine/dist` or `packages/operator-config/dist`
- PASS: `pnpm --filter @murphai/hosted-web typecheck:prepared`
- PASS: `pnpm --filter @murphai/operator-config typecheck`
- PASS: `pnpm --filter @murphai/assistant-engine typecheck`
- PASS: `pnpm --filter @murphai/operator-config exec vitest run --config vitest.config.ts --no-coverage test/http-linq-device-runtime.test.ts test/runtime-helpers.test.ts test/http-linq-device-runtime-branches.test.ts`
- PASS: `pnpm --filter @murphai/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-generate-image-tool.test.ts`
- PASS: `pnpm --filter @murphai/hosted-web prisma:generate && pnpm --filter @murphai/hosted-web exec vitest run --config vitest.workspace.ts --no-coverage test/hosted-onboarding-linq-http.test.ts test/hosted-onboarding-linq-first-contact-admission.test.ts`
- PASS: `pnpm install --frozen-lockfile`
- PASS: `pnpm deps:guard`
- PASS: `pnpm deps:ignored-builds`
- PASS: `git diff --check`
- FAIL (pre-existing transitive advisories outside the new SDK packages): `pnpm deps:audit`
Status: completed
Updated: 2026-06-26
Completed: 2026-06-26

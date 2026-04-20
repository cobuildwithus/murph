## Goal

Hard-cut hidden root fallback surfaces for subpath-only workspace packages, focused on `@murphai/messaging-ingress` and `@murphai/cloudflare-hosted-control`.

## Success Criteria

- Source-resolution helpers stop generating root aliases for workspace packages that do not export `"."`.
- Root TypeScript source aliases for those subpath-only packages are removed from shared path-mapping surfaces.
- Boundary coverage fails when a subpath-only package keeps a root barrel or a root source alias.
- The change stays narrow and does not broaden package surfaces or source-resolution behavior for packages that still intentionally export `"."`.

## Scope

- `config/workspace-source-resolution.ts`
- `scripts/workspace-source-resolution.test.ts`
- `scripts/workspace-boundaries/**`
- `tsconfig.base.json`
- `apps/web/tsconfig.json`
- `packages/messaging-ingress/**`
- `packages/cloudflare-hosted-control/**`
- focused verification follow-ups only if the narrowed package surface exposes stale root-artifact assumptions:
  - `scripts/build-test-runtime-prepared.mjs`
  - `packages/cli/test/cli-test-helpers.ts`
  - `packages/assistant-engine/src/assistant-cli-tools/execution-adapters.ts`

## Verification Plan

- `pnpm typecheck`
- `pnpm test:diff config/workspace-source-resolution.ts scripts/workspace-source-resolution.test.ts scripts/workspace-boundaries tsconfig.base.json apps/web/tsconfig.json packages/messaging-ingress packages/cloudflare-hosted-control`

## Notes

- Preserve hosted/web transpile package names for source compilation; only the hidden root alias path should be removed for subpath-only packages.
- Work carefully on top of the adjacent workspace-boundary tooling refactor if those files change during this task.
- Completed implementation:
  - root aliases are no longer generated for workspace packages that do not export `"."`
  - shared/app tsconfig path mappings now point only at the explicit public subpaths for the two targeted packages
  - both package-root `src/index.ts` barrels were removed and package metadata no longer advertises root `main` / `types`
  - workspace-boundary rules now reject root source aliases and revived root barrels for the two targeted subpath-only packages
  - supporting runtime/test harness expectations were updated to consume the explicit messaging-ingress subpath artifacts instead of the removed root build artifact
  - assistant CLI launcher fallback now avoids source-launcher fallback unless the environment explicitly prefers workspace source execution
- Verification:
  - `pnpm typecheck` passed
  - `pnpm --dir packages/messaging-ingress test` passed
  - `pnpm exec vitest run scripts/workspace-source-resolution.test.ts packages/messaging-ingress/test/package-boundary.test.ts packages/cloudflare-hosted-control/test/routes.test.ts --no-coverage --reporter=verbose` passed
  - earlier diff-coverage run for this lane reached unrelated `apps/cloudflare/test/user-runner-hosted-wake.test.ts` failures; current diff does not touch that hosted-wake status/recovery surface
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20

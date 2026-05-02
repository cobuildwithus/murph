# Fix hosted web Vercel build OOM

Status: active
Created: 2026-05-03
Updated: 2026-05-03

## Goal

- Restore hosted web Vercel builds on the standard 4-core/8 GB builder by reducing `next build` memory pressure without raising the machine size or weakening production behavior.

## Success criteria

- The hosted web production build no longer statically bundles the monolithic generated Health Commons catalog.
- Health Commons public routes and measurement-method routes still resolve from generated artifacts and keep existing page behavior.
- Focused tests cover the new build-memory boundary and touched route behavior.
- Required hosted-web verification/typecheck/build checks are run or any unrelated blockers are clearly named.

## Scope

- In scope:
  - Hosted web build-time data loading for Health Commons generated artifacts.
  - Tests or static guards that prevent reintroducing the large generated catalog into Next route bundles.
  - Minimal config changes only if local evidence shows the OOM comes from Next/Workflow build configuration.
- Out of scope:
  - Vercel machine-size changes or deploy-setting workarounds.
  - Health Commons content changes unrelated to build memory.
  - Hosted onboarding, auth, billing, or runtime behavior changes.

## Constraints

- Technical constraints:
  - Preserve repo-local workspace source resolution and package-boundary rules.
  - Do not import generated JSON into client bundles when a server/runtime read is sufficient.
  - Keep generated artifacts ignored unless the existing workflow explicitly requires regeneration for verification.
- Product/process constraints:
  - Preserve unrelated dirty work in this shared checkout.
  - Do not expose local usernames, home paths, secrets, or raw production env values.

## Risks and mitigations

1. Risk: Moving generated catalog loading from static import to runtime file reads could change tracing or deployment artifact inclusion.
   Mitigation: Keep explicit output tracing includes for required generated artifacts and add tests for catalog absence from public route traces/source.
2. Risk: Build-memory fixes could mask rather than fix the root cause.
   Mitigation: Measure local build/resource behavior where feasible and target the largest known build-time artifact path.

## Tasks

1. Inspect hosted app build config, generated artifact sizes, and Health Commons route imports.
2. Patch the build/data-loading path to avoid compiler ingestion of the monolithic catalog.
3. Add focused regression tests for the memory boundary and route behavior.
4. Run focused checks, then hosted web build/typecheck/lint or the required scoped fallback.
5. Run completion audits, close the plan, and commit if a safe scoped commit is possible.

## Decisions

- Use a code-level fix before considering larger Vercel builders; the log shows an OOM during `next build`, so raising memory would only hide build graph pressure.
- Treat the 54 MB generated Health Commons catalog static import as the first root-cause target because it is already guarded out of public Health Commons route bundles and is far larger than the route-level web artifacts.

## Verification

- Commands to run:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/health-commons-route-bundle-boundary.test.ts apps/web/test/health-commons-measurement-method-detail.test.ts apps/web/test/next-config.test.ts`
  - `pnpm --dir apps/web lint`
  - `pnpm --dir apps/web typecheck`
  - `pnpm --dir apps/web build` or the narrowest equivalent production build proof if local resource limits block it.
- Expected outcomes:
  - Focused tests pass.
  - Lint/typecheck pass or fail only on named unrelated dirty-tree blockers.
  - Production build completes locally with lower memory pressure or exposes the next concrete blocker.

# Fix hosted web routes source path for CI

Status: active
Created: 2026-05-22
Updated: 2026-05-22

## Goal

- Restore the hosted web production build in the Murph Host Support workflow by making the `@murphai/hosted-execution/routes` subpath resolve from source in `apps/web` clean-checkout builds.

## Success criteria

- `apps/web` has an explicit TypeScript source path for `@murphai/hosted-execution/routes`.
- A focused regression test proves the hosted web path map includes that subpath.
- Focused verification covers the route resolution failure and the prior importer mock failure from the failing CI run.

## Scope

- In scope:
- `apps/web/tsconfig.json`
- `apps/web/test/next-config.test.ts`
- Focused verification for `apps/web` path mapping and `packages/importers` coverage test.
- Out of scope:
- Runtime behavior changes to hosted device-sync recovery.
- Broader workspace source-resolution redesign.

## Constraints

- Technical constraints:
- Preserve package public-entrypoint policy and keep the web app on source-resolved workspace imports in local/CI builds.
- Product/process constraints:
- Do not expose local paths, account identifiers, secrets, or raw CI log contents in repo files or commit text.

## Risks and mitigations

1. Risk: a root `tsconfig.base.json` path exists but `apps/web/tsconfig.json` overrides `paths`, so the app build can still miss the subpath.
   Mitigation: add the app-local path and assert it in `apps/web/test/next-config.test.ts`.

## Tasks

1. Add the missing hosted-execution routes source path to the app tsconfig.
2. Add the focused regression assertion.
3. Run focused verification for app config and the importer mock failure.
4. Close the plan through the scoped commit path.

## Decisions

- Treat the failing import as an app-local path-map omission, not a package export omission, because the package already declares the `./routes` export.

## Verification

- Commands to run:
- `pnpm --dir apps/web test -- next-config.test.ts`
- `pnpm --dir packages/importers test:coverage -- importers-factory-core-coverage.test.ts`
- `pnpm typecheck`
- Additional focused app build/verify if the first app checks do not exercise the failing Next production type step.
- Expected outcomes: all pass.

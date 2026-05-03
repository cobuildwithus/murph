# Align assistant CLI bridge env constants

Status: completed
Created: 2026-05-03
Updated: 2026-05-03

## Goal

- Remove duplicated hosted CLI bridge environment-name strings from `packages/assistant-engine` by importing the constants from their hosted-execution owner.

## Success criteria

- `assistant-cli-access.ts` keeps its existing public compatibility alias while deriving values from `@murphai/hosted-execution/cli-runtime-bridge`.
- `packages/assistant-engine` declares the new workspace dependency and the lockfile matches the manifest.
- Dependency hygiene, focused assistant-engine verification, and required completion audits pass or any unrelated blocker is documented.

## Scope

- In scope:
  - `packages/assistant-engine/src/assistant-cli-access.ts`
  - `packages/assistant-engine/test/assistant-cli-access.test.ts`
  - `packages/assistant-engine/package.json`
  - `packages/assistant-engine/tsconfig.json`
  - `pnpm-lock.yaml`
- Out of scope:
  - Changing hosted bridge protocol names or env projection behavior.
  - Allowing model/CLI-supplied bridge return metadata.
  - Broader assistant-engine dependency cleanup.

## Constraints

- Preserve the existing `HOSTED_RUNTIME_PROCESS_ENV_MARKER` export for assistant-engine callers and tests.
- Use `workspace:*` for the internal package dependency.
- Do not stage or commit unrelated dirty work.

## Risks and mitigations

1. Risk: Adding a workspace dependency creates a package cycle.
   Mitigation: Run dependency guards/typecheck and inspect the dependency direction.
2. Risk: Importing the hosted bridge owner changes runtime behavior.
   Mitigation: Reuse only exported constants and keep the local env projection list unchanged.

## Outcome

- `assistant-cli-access.ts` now imports the hosted bridge runtime marker, URL env, and token env constants from `@murphai/hosted-execution/cli-runtime-bridge`.
- `HOSTED_RUNTIME_PROCESS_ENV_MARKER` remains exported as a compatibility alias.
- `packages/assistant-engine` now declares the hosted-execution workspace dependency and project-reference edge.
- The focused test now asserts the alias and uses the shared bridge constants when proving hosted env projection.

## Verification

- `pnpm install --lockfile-only` passed.
- `pnpm install` passed and materialized the new workspace link.
- `pnpm deps:guard` passed.
- `pnpm deps:ignored-builds` passed and reported the existing ignored build-script list.
- `pnpm deps:audit` failed on existing unrelated workspace advisories for Playwright, Hono, Effect, lodash, defu, and Vite.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-cli-access.test.ts` passed.
- `pnpm --dir packages/assistant-engine test:coverage` passed.
- `pnpm typecheck` passed.
- `pnpm --dir packages/cli verify:package-shape` failed before `pnpm install` because the new workspace symlink was not materialized, then passed after `pnpm install`.
- Security/privacy review, coverage-write review, and final completion review returned no findings.

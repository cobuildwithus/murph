# Align assistant CLI bridge env constants

Status: active
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

## Tasks

1. Register the plan/ledger row.
2. Import shared constants and add the workspace dependency.
3. Refresh the lockfile.
4. Run focused verification plus dependency checks and audits.
5. Close the plan and create a scoped commit.

## Verification

- Commands to run:
  - `pnpm deps:guard`
  - `pnpm deps:audit`
  - `pnpm deps:ignored-builds`
  - `pnpm typecheck`
  - Focused assistant-engine test/coverage for `assistant-cli-access`.

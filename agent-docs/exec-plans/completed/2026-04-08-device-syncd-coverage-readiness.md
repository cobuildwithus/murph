# Package-local coverage readiness for `@murphai/device-syncd`

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Raise package-local test and Vitest coverage readiness for `@murphai/device-syncd` so the root repo coverage lane can later switch this package from curated file lists to package-wide include patterns.
- Keep all implementation inside `packages/device-syncd/**` and reuse existing package helpers where possible.

## Success criteria

- `packages/device-syncd/vitest.config.ts` carries package-local coverage settings suitable for package-wide source inclusion.
- Package-local tests cover the currently under-served helper and boundary seams enough that package-wide coverage is realistic.
- Any new test utilities stay under `packages/device-syncd/test/**` and reuse existing provider/service helpers instead of cloning setup.
- Package-local verification is run, and any environment-specific blockers or root-integration follow-ups are documented precisely.

## Scope

- In scope:
  - `packages/device-syncd/vitest.config.ts`
  - package-local tests under `packages/device-syncd/test/**`
  - package-local shared helpers under `packages/device-syncd/test/**`
- Out of scope:
  - root `vitest.config.ts`
  - `config/**`
  - changes in other packages

## Constraints

- Preserve unrelated worktree edits.
- Keep package ownership local to `packages/device-syncd/**`.
- Prefer existing helper reuse over new setup scaffolding.
- Spawn package-internal GPT-5.4 high subagents on disjoint seams, then integrate locally.
- Do not commit; report root-integration needs in handoff.

## Risks and mitigations

1. Risk: Package-wide coverage includes low-value surface files and forces brittle tests.
   Mitigation: Classify which source files should be covered directly versus through export-surface or integration tests, and keep exclusions narrow and justified.
2. Risk: New tests duplicate provider or HTTP setup already present in the package.
   Mitigation: Reuse `test/helpers.ts` and existing provider/service fixtures before introducing any new helper.
3. Risk: Local verification is partially blocked by sandbox restrictions around loopback listeners.
   Mitigation: Run all package-local checks that the environment supports and document the exact blocked command and failure mode.

## Tasks

1. Inventory package source files against the existing tests and identify the seams that still block package-wide coverage.
2. Use package-internal subagents for disjoint seam analysis and implementation ideas.
3. Add package-local coverage configuration and targeted tests under `packages/device-syncd/**`.
4. Run package-local verification and capture any root integration or sandbox constraints.

## Decisions

- Keep the entire diff package-local and leave root coverage wiring to the parent integration lane.
- Bias new tests toward helper, public-ingress, and webhook/account redaction seams that can raise package-wide coverage without unstable runtime coupling.
- Treat the HTTP listener binding failure in this sandbox as an environment constraint unless package-local code inspection shows a real regression.

## Verification

- Commands to run:
  - `pnpm --dir packages/device-syncd test`
  - `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts --coverage.enabled`
  - `pnpm typecheck`
- Expected outcomes:
  - Package-local tests pass where the sandbox permits them, or any environment-specific failure is isolated and documented.

## Outcome

- Added package-local coverage config in `packages/device-syncd/vitest.config.ts` using package-wide `src/**/*.ts` include patterns with a package-local `src/bin.ts` exclusion.
- Expanded package-local tests for pure helpers, hosted-runtime parsing, provider webhook edge cases, public-ingress failure paths, config parsing, client request helpers, shared utilities, and hosted-store hydration.
- Package-local `typecheck` passed.
- Package-local Vitest passed when excluding the sandbox-blocked `test/http.test.ts` listener file.
- Full package test and coverage runs in this environment still fail because `test/http.test.ts` cannot bind `127.0.0.1` (`listen EPERM`), and package-wide per-file coverage remains below the repo root thresholds for the runtime-heavy `http`, `service`, `store`, and several provider modules.

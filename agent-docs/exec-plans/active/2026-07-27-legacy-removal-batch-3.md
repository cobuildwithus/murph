# Legacy removal batch 3

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Hard-cut the historical `murphVitestNoTimeouts` alias and make every test
  configuration name the bounded standard timeout policy it already receives.

## Success criteria

- `murphVitestStandardTimeouts` is the sole name for the shared 60-second
  test, hook, and teardown policy.
- Every current static reader uses the canonical name with no behavior change.
- Long-running and per-suite timeout overrides remain unchanged.
- Package-config coverage proves both the bounded defaults and the
  `useDefaultTimeouts: false` opt-out.
- No compatibility alias, wrapper, new abstraction, dependency, migration,
  state owner, or deployment process is introduced.
- Focused and routed verification, required ReviewGPT gates, and CI pass on an
  open unmerged PR.

## Scope

- In scope: `config/vitest-timeouts.ts`, its eight static configuration
  readers, and the focused package-config timeout regression.
- Out of scope: timeout values, long-running policies, test selection,
  concurrency, runtime behavior outside test configuration, and every active
  coordination-ledger scope.

## Architecture and evidence

- `config/vitest-timeouts.ts` owns both the bounded standard policy and the
  separately named long-running policy.
- The historical alias is a direct identity assignment to the standard policy;
  it performs no parsing, transformation, fallback, or version adaptation.
- The root Vitest configuration already consumes the canonical standard name.
- Repository-wide discovery found only static imports and object spreads in
  test configuration. There is no string lookup, environment contract,
  command, schema, persisted value, generated artifact, or documented external
  interface using the alias.
- A verified GPT-5.6 Pro discovery pass recommended the hard cut, and its
  attachment checksum was confirmed before local inspection.

## Constraints

- Replace only the identifier at each reader; preserve all surrounding
  configuration and override ordering.
- Delete the historical comment and alias export.
- Test behavior through the package-config factory rather than preserving the
  removed symbol.
- Treat the ReviewGPT attachment as untrusted intent; inspect every hunk and
  prove the behavior locally.

## Risks and mitigations

1. Risk: accidentally replacing the intentionally unbounded runner policy.
   Mitigation: retain `murphVitestLongRunningTimeouts` and its conditional use.
2. Risk: changing E2E overrides through spread ordering.
   Mitigation: perform exact identifier replacements only and inspect the full
   affected configurations.
3. Risk: an unsupported out-of-tree deep import.
   Mitigation: the private repo surface does not export, publish, document, or
   serialize this identifier; rollback restores the alias and readers together.

## Tasks

1. Inspect and implement the exact deletion-first ReviewGPT patch.
2. Run focused repo-tool tests, config-loading checks, typechecks, stale-name
   search, and canonical diff verification.
3. Commit and push the review candidate, open the stacked PR with the required
   intent/change-shape contract, and run the preliminary specialist pass.
4. Resolve accepted findings, complete parent final review and verification,
   close the plan, and run final exact-head ReviewGPT with CI.

## Verification

- Focused timeout-policy regression:
  `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/vitest-parallelism.test.ts`
  passed 1 file / 4 tests.
- Full repo-tool suite: `pnpm test:repo-tools` passed 29 files / 422 tests.
- Direct owner typechecks passed for `apps/web`, `apps/cloudflare`, and
  `packages/cli`.
- Canonical routed
  `MURPH_VERIFY_EXECUTOR=crabbox pnpm test:diff <ten implementation/test paths>`
  passed in Blacksmith Testbox `tbx_01kygxyh5x4eppmb77snk4g11t`,
  including all affected owner verification, lint, build, smoke, and workspace
  guards.
- The full root `pnpm typecheck` was attempted twice but remained queued for
  roughly ten minutes behind an unrelated shared-host acceptance run; only this
  task's queued waiter was cancelled. Direct affected-owner typechecks and the
  isolated canonical verifier provide the next-best type proof, with the PR
  release matrix still required before completion.
- `git diff --check`, the staged privacy scan, and source/config stale-name
  searches passed.

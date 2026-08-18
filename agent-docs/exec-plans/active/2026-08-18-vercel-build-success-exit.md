# Simplify Vercel builds on Standard machines

Status: active
Created: 2026-08-18
Updated: 2026-08-18

## Goal

- Give Next and Vercel sole ownership of the hosted Web production build:
  compile Webpack in the Next CLI process and remove the production-only local
  verification supervisor, deadline, and process-group reaper.

## Success criteria

- Production builds do not use the shared-host verification slot or custom
  command deadlines.
- The Workflow-customized Webpack build runs in the Next CLI process instead
  of a separately forced build worker.
- The local verification slot retains admission, status propagation, and
  external-signal forwarding without production lifecycle behavior.
- Focused supervisor and production build-contract tests pass.
- The required direct-main acceptance gate passes on the final reconciled
  candidate.
- The landed production deployment reaches Vercel's completed state; Standard
  machine proof is captured when the project setting permits it.

## Scope

- In scope:
  - Hosted Web package, Vercel entrypoint, Next config, and production runner.
  - Deletion of production deadline/reaper behavior from the local verification
    slot.
  - Focused build-contract and verification-slot regressions.
- Out of scope:
  - Vercel project machine-size configuration.
  - Changes to shared-host slot admission.

## Constraints

- Technical constraints:
  - Keep the cold Webpack cache policy that prevents the proven warm-cache OOM.
  - Preserve explicit route-aware TypeScript validation before compilation.
  - Keep Webpack and TypeScript heap limits sequential and within the Standard
    builder's 8 GB boundary.
- Product/process constraints:
  - Preserve unrelated primary-checkout work by implementing in the sanctioned
    task worktree.
  - Treat the build wrapper as a production deploy boundary and complete the
    routed reliability review and verification gates.

## Risks and mitigations

1. Risk: The in-process compiler could exhaust its heap.
   Mitigation: Give the single compiler the previously proven 3 GiB worker
   budget, retain Next's memory optimizations and cold Webpack cache, and prove
   the exact path locally and on a Standard deployment.
2. Risk: Removing the supervisor could weaken local verification admission.
   Mitigation: Keep the slot's local admission and signal-forwarding behavior
   intact and run its focused suite.

## Tasks

1. Remove the production wrapper and timeout environment contract.
2. Delete deadline/reaper machinery from the local verification slot.
3. Let Next's custom-Webpack default keep compilation in-process and use one
   compiler heap budget.
4. Run focused syntax, supervisor, build-contract, and production-build proof.
5. Complete routed review and CI, land the exact commit, and monitor Standard.

## Decisions

- Keep the cold-Webpack cache policy; prior live deployments prove restored warm
  Webpack caches can exceed the Standard builder memory boundary.
- Do not force `webpackBuildWorker`: Next 16.3 disables it when the application
  supplies custom Webpack configuration, which keeps one compiler owner.
- Vercel owns production cancellation and build deadlines.

## Verification

- Commands to run:
  - `node --check scripts/run-with-host-verification-slot.mjs`
  - `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/run-with-host-verification-slot.test.ts`
  - Focused hosted Web production build-contract tests selected from the
    current app test configuration.
  - `pnpm verify:acceptance`
- Expected outcomes:
  - Local verification-slot tests prove admission, status propagation, and
    signal forwarding without any production deadline contract.
  - Production build scripts retain the intended Webpack, cache, heap,
    migration, and prepared-TypeScript contract with one compiler process.

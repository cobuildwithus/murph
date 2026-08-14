# Add the device-sync closed-loop quiescence contract

Status: completed
Created: 2026-08-13
Updated: 2026-08-14

## Goal

- Add one deterministic, closed-loop device-sync contract that proves admitted
  work is conserved and the composed scheduler/runtime/checkpoint lifecycle
  reaches quiescence after external work and transient faults stop.

## Success criteria

- The test drives repeated global sweep buckets and runtime cycles with a fake
  clock instead of stopping after one successful pass.
- It proves local retry/lease clocks and generic runtime timers cannot mint
  global provider work.
- It proves checkpoint retries and cold restore retain existing ownership,
  remain linearly bounded, and eventually settle to zero new work.
- The implementation reuses production functions and existing test support,
  adds no production state owner or recovery subsystem, and stays fast enough
  for path-triggered PR CI.
- Focused tests, typecheck, exact-head CI, required ReviewGPT stages, and parent
  final review pass.

## Scope

- In scope: deterministic synthetic state, fake time, repeated due-sweep and
  runtime cycles, bounded checkpoint fault injection, convergence assertions,
  and the smallest CI/test-map wiring needed to keep the contract discoverable.
- Out of scope: real Postgres/Temporal/MinIO replay, production canary controls,
  runtime monitoring, copied production rows, new queues, or production
  behavior changes.

## Constraints

- Technical constraints: use package public entrypoints and existing owners;
  do not cross-import sibling internals, duplicate the production state
  machine, add a dependency, or introduce a permanent test framework for one
  scenario.
- Product/process constraints: ReviewGPT authors the patch; the parent treats
  it as untrusted intent, inspects every hunk, verifies it, and lands it as its
  own PR.

## Risks and mitigations

1. Risk: a large synthetic harness merely reimplements production behavior.
   Mitigation: compose real production functions and keep adapters limited to
   time, persistence, transport, and fault boundaries.
2. Risk: exact checkpoint counts make the test brittle.
   Mitigation: assert ownership-derived upper bounds, convergence, and zero-work
   terminal buckets rather than incidental call order.

## Tasks

1. [x] Ask ReviewGPT for the smallest maintainable patch against the exact base.
2. [x] Inspect and apply the returned patch deliberately.
3. [x] Run focused proof and candidate review; simplify any unnecessary harness.
4. [ ] Commit, push, open the PR, and run required specialist/final gates and CI.
5. [ ] Resolve findings, perform parent final review, and merge when authorized
   and green.

## Decisions

- This is a behavior-preserving test/direct-proof PR and remains independent of
  the clock provenance PR. Two existing runtime declarations move unchanged to
  narrow leaf owners so the testkit does not import the broad platform graph;
  no production behavior changes.
- The real-stack incident replay and production rollout guard are deferred.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --project hosted-web-sync-settings --no-coverage apps/web/test/hosted-device-sync-closed-loop-quiescence.test.ts`
  - Passed: 2 tests.
- `pnpm --dir apps/web typecheck`
  - Passed.
- `pnpm --dir packages/assistant-runtime typecheck`
  - Passed.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/package-entrypoints.test.ts`
  - Passed: 22 tests.
- `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/workspace-source-resolution.test.ts scripts/workspace-boundaries/import-policy-rules.test.ts`
  - Passed: 44 tests.
- `pnpm docs:drift`
  - Passed.
- `node scripts/verify-workspace-boundaries.mjs`
  - Blocked by two pre-existing unrelated violations in
    `apps/web/test/device-sync-hosted-wake.test.ts` and
    `apps/web/test/hosted-crypto-gcp-kms.test.ts`; ReviewGPT's before/after
    comparison found identical output.
- `git diff --check`
  - Passed.
- Required exact-head GitHub Actions and routed ReviewGPT gates run after the
  candidate commit is pushed.
Completed: 2026-08-14

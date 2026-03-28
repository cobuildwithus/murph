# Hosted Runtime Seams

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

Split `packages/assistant-runtime/src/hosted-runtime.ts` into smaller internal modules without changing hosted execution ordering, idempotency, explicit `member.activated` bootstrap rules, durable committed-side-effect replay, or resume semantics.

## Success criteria

- `packages/assistant-runtime/src/hosted-runtime.ts` becomes a thin public entrypoint and high-level orchestrator.
- Internal modules separate restore/bootstrap/context preparation, per-event handling, maintenance execution, commit/finalize plus committed-side-effect delivery, and env/isolated-run helpers.
- The existing Cloudflare/node-runner integration tests continue to prove:
  - explicit activation bootstrap and non-activation guard
  - hosted email/share/event handling
  - durable commit before side-effect replay
  - journal replay before finalize
  - resume replay without recompute or recommit
  - isolated per-job env concurrency
- Add focused seam-level tests for the new extracted modules where practical without replacing the existing integration safety net.

## Scope

- In scope:
  - internal module extraction under `packages/assistant-runtime/src/hosted-runtime/**`
  - keeping the current public exports stable
  - focused package-level seam tests plus targeted `apps/cloudflare/test/node-runner.test.ts` updates if import shape or proof coverage requires it
- Out of scope:
  - changing hosted execution behavior, callback order, or bundle semantics
  - Cloudflare routing/container architecture changes
  - new persistence models or generalized runtime abstractions

## Constraints

- Preserve the existing call order around commit/finalize and committed-side-effect replay.
- Keep `member.activated` bootstrap explicit and separate from the per-event dispatch layer.
- Resume must keep skipping compute and durable commit while still replaying committed side effects and finalizing returned bundles.
- Do not revert unrelated dirty work already present in the shared tree.

## Risks

1. A seam extraction could accidentally move bootstrap checks or local-runtime prep across event handling.
2. A refactor could move side-effect collection or delivery across the durable commit boundary.
3. Resume and fresh-run paths could diverge or recompute accidentally.

## Plan

1. Extract shared contracts/types and env/isolated-run helpers first, keeping public exports stable.
2. Extract context/bootstrap preparation and per-event handlers behind a dedicated dispatch module without changing call order.
3. Add seam-level tests for the extracted dispatch/context modules.
4. Extract the maintenance loop and pre-commit committed-result assembly.
5. Extract commit/finalize plus committed-side-effect delivery into their own module, preserving exact ordering.
6. Run focused verification, then required repo checks, and report any unrelated pre-existing failures separately.

## Verification

- Focused while iterating:
  - `pnpm exec vitest run apps/cloudflare/test/node-runner.test.ts packages/assistant-runtime/test/*.test.ts --no-coverage --maxWorkers 1`
  - `pnpm --dir packages/assistant-runtime typecheck`
- Required repo checks before handoff:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`

## Progress

- Done:
  - reviewed runtime/docs/tests and mapped the current hosted execution phases plus invariants
  - extracted the thin top-level orchestrator plus internal `hosted-runtime/**` seams for context/bootstrap, per-event handlers, maintenance, callbacks, and environment/isolation helpers
  - added focused seam tests for hosted context and maintenance plus targeted node-runner coverage for the extracted Telegram/event path
  - verified focused hosted-runtime and Cloudflare integration suites
- Now:
  - none
- Next:
  - monitor unrelated workspace `packages/cli` build/test failures separately from this hosted-runtime lane if repo-wide wrappers must go green

## Outcome

- `packages/assistant-runtime/src/hosted-runtime.ts` is now a thin entrypoint/orchestrator.
- Execution ordering is preserved:
  - fresh runs still do restore/env -> dispatch/bootstrap/event -> maintenance -> committed snapshot/side-effect collection -> durable commit -> committed side-effect replay -> verified-email reconciliation/status refresh -> final snapshot -> conditional finalize
  - resume still skips compute and durable commit, then replays committed side effects before finalize
- `member.activated` bootstrap remains explicit and separate from event handling.

## Verification results

- Passed:
  - `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/node-runner.test.ts --no-coverage --maxWorkers 1`
  - `pnpm --dir apps/cloudflare verify`
  - `pnpm typecheck`
- Failed outside this lane:
  - `pnpm test`
    - pre-existing `packages/cli` failures including missing built modules such as `explicit-health-family-services.js` and related CLI/runtime import errors
  - `pnpm test:coverage`
    - `packages/cli` TypeScript errors in `src/usecases/{explicit-health-family-services.ts,health-services.ts}`
Completed: 2026-03-28

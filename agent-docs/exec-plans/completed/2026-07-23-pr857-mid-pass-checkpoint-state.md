# PR 857 Mid-Pass Checkpoint State Remediation

Status: completed
Created: 2026-07-23
Updated: 2026-07-23

## Goal

- Preserve in-flight hosted-runtime scheduling state when the direct-session durability boundary publishes a workspace snapshot before provider execution.

## Success criteria

- A welcome-created direct session absent from the restored snapshot is durably published before provider execution.
- The boundary advances the committed workspace without rewinding the active pass's wake, projection, or status state.
- Due assistant follow-up work remains serviceable after the checkpoint instead of returning as a stale model-capable wake.
- Existing full workspace rebases remain unchanged at between-pass and final checkpoint boundaries.
- Focused regression coverage, Runtime typecheck, canonical diff verification, and canonical acceptance pass.

## Scope

- In scope: the Runtime-owned direct-session checkpoint boundary, focused hosted-runtime regression coverage, and moving the shutdown-publication E2E barrier so it does not intercept the required pre-provider checkpoint.
- Out of scope: new persisted state, new queues, usage-gate changes, orchestration changes, or broad checkpoint refactors.

## Root-cause evidence

- Exact-head hosted E2E reproduced twice while the base branch and the previous PR head passed.
- Both repeated failures began only after the welcome-session checkpoint correction.
- The new pre-provider checkpoint runs inside an active foreground pass, but its full workspace rebase also resets the invocation-local projected-wake key and status state from the published pre-provider workspace.
- The wake value is later merged back from the pass result, but without its invocation-local key it misses same-invocation servicing, is durably republished as due, and becomes usage-gated after the first response crosses the allowance.
- A focused mutation check proved the regression: restoring the old rebase produced an extra checkpoint containing the due assistant wake before the wake was serviced.

## Tasks

1. [x] Add focused regression coverage for active-pass state across the pre-provider checkpoint.
2. [x] Replace the mid-pass full rebase with the minimum committed-workspace advance.
3. [x] Keep the shutdown-publication E2E barrier scoped to the shutdown checkpoint.
4. [x] Run canonical diff and acceptance verification.
5. [x] Complete the parent diff review and package the verified remediation candidate.

## Verification

- Focused hosted-runtime workspace entrypoint regression.
- Assistant Runtime package typecheck and affected test suites.
- Canonical `pnpm test:diff` and `pnpm verify:acceptance`.
- Exact-head GitHub CI and final ReviewGPT correction-verification round.

## Evidence

- `pnpm hosted-local e2e usage-limit-ambiguous-send`: passed.
- `pnpm hosted-local e2e shutdown-checkpoint-conversation-ahead --no-bundle`: passed.
- Assistant Runtime workspace entrypoint suite: 242 tests passed.
- Assistant Runtime and Cloudflare package typechecks: passed.
- Crabbox `pnpm test:diff packages/assistant-runtime apps/cloudflare`: passed.
- Crabbox `pnpm verify:acceptance`: passed.

## Post-plan gates

- Push the exact remediation head, clear exact-head GitHub CI, and complete ReviewGPT round 6 before merge readiness.
Completed: 2026-07-23

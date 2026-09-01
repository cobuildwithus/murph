# Real hosted runtime handoff regression

Status: completed
Created: 2026-09-01
Updated: 2026-09-01

## Goal

- Add a deterministic full-stack regression that proves a conversation message
  accepted during terminal idle-checkpoint publication can remain unprocessed
  until Temporal's distant accepted-owner horizon unless another message arrives.

## Success criteria

- Run actual local Web, managed Temporal with the private worker, Cloudflare
  Worker/Durable Object/container, assistant runtime, Postgres, and mailbox
  paths; stub only external Linq and model-provider transports.
- Pause the real idle-shutdown snapshot publication with the existing
  test-only barrier, accept one signed Linq ingress while it is held, release
  it, and send no second message.
- Require the first message to reach provider start and Linq delivery within a
  short foreground bound after the checkpoint owner releases.
- Prove the new scenario fails against the current implementation at that
  assertion, with no production behavior change in this task.

## Scope

- In scope: one hosted-local E2E scenario, scenario registry wiring, and the
  smallest reusable test helpers already owned by the harness.
- Out of scope: fixing the runtime/Temporal handoff, production mutation,
  mocked Murph orchestration activities, or new scheduler/retry ownership.

## Constraints

- Technical constraints: preserve real component boundaries; use an existing
  deterministic timing barrier instead of sleeps to create the race; keep all
  fixture identities synthetic; release the barrier and stop only processes
  owned by the scenario.
- Product/process constraints: internal regression coverage only, with no
  user-facing product change or Product UX walkthrough required.

## Risks and mitigations

1. Risk: a component mock could reproduce an invented state rather than the
   real bug.
   Mitigation: drive signed Web ingress and assert actual provider/delivery
   effects through the full hosted-local stack; external vendor stubs are the
   only substitutes.
2. Risk: timing alone could make the test flaky.
   Mitigation: wait for the existing checkpoint-publication barrier's entered
   state before ingress, then release it explicitly.
3. Risk: a red regression could wait through the production-scale recheck
   horizon.
   Mitigation: fail on the missing prompt provider entry within a bounded
   foreground window and include secret-safe full-stack diagnostics.

## Tasks

1. Trace the existing checkpoint barrier, signed Linq ingress, Temporal query,
   provider recorder, and Linq delivery helpers.
2. Add and register a dedicated full-stack hosted-local scenario.
3. Run the scenario and confirm the expected red failure without a second
   message.
4. Run focused static/type verification, inspect the privacy-safe diff, and
   commit the regression artifact.

## Decisions

- Reuse the existing idle-shutdown publication barrier. It pauses the real
  checkpoint request immediately before commit and does not replace any Murph
  owner.
- Keep the external provider and Linq transports deterministic; do not mock
  Web, Temporal activities, Cloudflare, container execution, runtime, mailbox,
  checkpoint, or delivery ownership.

## Verification

- `MURPH_DEV_TEMPORAL_WORKER_PACKAGE_DIR=<private-worker-package> pnpm
  hosted-local e2e idle-checkpoint-runtime-handoff --no-bundle`: expected red.
  The signed foreground wake advanced the real Temporal workflow to an
  accepted `runtime_wake_recheck` horizon, the checkpoint owner released, the
  conversation mailbox remained one item behind, and no assistant-provider
  request appeared inside the 20-second foreground bound.
- `pnpm --dir apps/cloudflare typecheck`: passed.
- `pnpm --dir packages/hosted-local-harness typecheck`: passed.
- `pnpm --dir packages/hosted-local-harness exec vitest run --config
  vitest.config.ts test/hosted-local.test.ts test/cli.test.ts --no-coverage`:
  passed, 34 tests.
- `git diff --check`: passed.
Completed: 2026-09-01

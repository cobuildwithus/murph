# Drain hosted runtime internal work until idle or budget

Status: completed
Created: 2026-04-20
Updated: 2026-04-20

## Goal

- Make hosted `runDrain` execution keep draining runtime-local assistant and device-sync follow-up work in-process until the runtime is idle or a bounded internal drain budget is exhausted.
- Preserve the greenfield run-centric protocol: internal follow-ups stay runtime-local and surface externally only as `nextRuntimeWakeAt`.

## Success criteria

- `executeHostedRunDrainForCommit` no longer stops after a single assistant/device-sync maintenance pass when the runtime reports immediately due internal work.
- The runtime snapshots once per hosted run after bounded internal drain work finishes.
- Focused assistant-runtime coverage proves repeated immediate assistant/device-sync work drains locally and still falls back to `nextWakeAt` when the bounded budget is exhausted.

## Scope

- In scope:
- `packages/assistant-runtime/src/hosted-runtime/execution.ts`
- Direct assistant-runtime tests covering hosted run-drain execution
- Out of scope:
- Web/Postgres cursor contracts
- Cloudflare acquire/commit/finalize flow
- Any web-materialized internal wake compatibility lane

## Constraints

- Technical constraints:
- Do not reintroduce `assistant.cron.tick` or any web-visible internal follow-up lane.
- Preserve existing hosted runtime maintenance helpers and adjacent in-flight assistant-runtime work where possible.
- Product/process constraints:
- Treat repeated near-immediate hosted reruns as a bug in greenfield hosted execution, not as compatibility behavior.
- Keep the diff narrow because the tree is already dirty in adjacent hosted-runtime and Cloudflare lanes.

## Risks and mitigations

1. Risk: An unbounded loop could keep a hosted run spinning forever if a maintenance lane keeps returning an immediate wake.
   Mitigation: Add an explicit bounded drain budget and leave any leftover due work surfaced through `nextWakeAt`.

2. Risk: Narrowing to runtime-local draining could accidentally skip device-sync or assistant follow-up work.
   Mitigation: Track assistant and device-sync due state separately and add focused regression coverage for both.

## Tasks

1. Inspect `executeHostedRunDrainForCommit` and identify where immediate maintenance follow-ups escape into `nextWakeAt`.
2. Add a bounded in-process drain loop for immediate assistant and device-sync runtime work before snapshotting.
3. Add/update focused assistant-runtime tests for drain-until-idle and budget-exhausted behavior.
4. Run scoped verification plus required completion-workflow audit passes, then finish with a scoped commit.

## Decisions

- Greenfield hosted execution should drain immediate internal follow-up work locally instead of relying on another hosted run to finish it.
- The bounded fallback should remain `nextWakeAt`, not a materialized wake row.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:diff packages/assistant-runtime/src/hosted-runtime/execution.ts packages/assistant-runtime/test/hosted-runtime-run-drain-coverage.test.ts packages/assistant-runtime/test/hosted-runtime-finalize-coverage.test.ts`
- Expected outcomes:
- Assistant-runtime typecheck and focused coverage pass for the changed execution path.
Completed: 2026-04-20

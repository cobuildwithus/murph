# Linq typing container prewarm

Status: completed
Created: 2026-05-27
Updated: 2026-05-27

## Goal

- Prewarm cold Cloudflare runner containers when an active iMessage Linq user starts typing, reducing message latency without treating typing as durable assistant work.

## Success criteria

- `chat.typing_indicator.started` can signal the existing per-user Temporal runtime workflow for active hosted Linq routes.
- The prewarm path uses a dedicated signal kind, Temporal activity, and Cloudflare `/runtime/prewarm` route.
- Typing prewarm never appends mailbox, never starts mailbox demand, never starts an assistant run, never begins a runtime write fence, and never consumes usage.
- A later `message.received` path remains unchanged and wins over any pending or in-flight prewarm; mailbox demand must never wait for a prewarm HTTP/activity result.
- Focused tests prove mailbox-send and prewarm cannot conflict.

## Scope

- In scope:
  - Linq typing event parsing.
  - Active-route-only web prewarm handoff with coarse coalescing.
  - Hosted execution signal/prewarm contracts and parsers.
  - Temporal workflow prewarm state/activity orchestration.
  - Cloudflare signed prewarm route and runner/container shell warmup.
  - Focused unit tests for no mailbox/run conflicts.
- Out of scope:
  - New onboarding behavior from typing.
  - Typing stopped handling.
  - Assistant runtime or mailbox demand changes for typing.
  - User-facing UI.

## Constraints

- Technical constraints:
  - Preserve the existing `runtimeSignal` Temporal signal name.
  - Do not add typing to hosted runtime demand run sources.
  - Do not call Cloudflare directly from webhook ingress.
  - Do not store raw chat ids, phone numbers, message content, provider payloads, or headers in Temporal state or logs.
  - Add Temporal replay compatibility gating for any new command-producing workflow path.
- Product/process constraints:
  - Clean, simple, composable architecture is the priority.
  - Preserve unrelated dirty work in overlapping Temporal and Cloudflare files.

## Risks and mitigations

1. Risk: typing prewarm races with a later iMessage mailbox send.
   Mitigation: prewarm is side-effect-limited to container readiness, uses no write fence, and the workflow must not await prewarm completion before processing a later mailbox/demand signal.
2. Risk: repeated typing events create noise or cost.
   Mitigation: web coalesces before Temporal and Temporal collapses repeated signals into one pending flag.
3. Risk: deploy skew between Temporal and Cloudflare.
   Mitigation: prewarm activity treats route rejection as retry-later/failed best-effort and clears stale hints.

## Tasks

1. Add Linq typing parse support and web signal helper.
2. Add hosted execution prewarm signal/request/response contracts.
3. Add Temporal activity and workflow prewarm handling.
4. Add Cloudflare prewarm route/runner/container method.
5. Add focused tests and run required verification.

## Decisions

- Use the existing per-user Temporal workflow with a new `runtime_prewarm_requested` signal kind, but keep the prewarm execution path non-blocking relative to later demand signals.
- Keep typing outside mailbox and `readRuntimeDemand`.
- Cloudflare prewarm route may only warm or observe the container shell; it must not call `ensureRuntimeProcessingForUser`.
- Keep prewarm payloads source-only: no channel route, no raw chat id, and no raw-hash chat scope in Temporal history.
- Use the shared `HOSTED_RUNTIME_PREWARM_TIMEOUT_MS` for the HTTP and Cloudflare readiness budget, with a pinned Temporal workflow Activity timeout that leaves response slack and must only change with replay proof.
- Keep prewarm strictly subordinate to real runtime work: no Activity retry after abandon, no fresh lifecycle-lock budget after queueing, and no slow cleanup wait while holding the prewarm lock.

## Verification

- Commands to run:
  - Focused tests for `messaging-ingress`, hosted execution contracts, hosted Linq webhook, Temporal workflow/activity, and Cloudflare route/runner.
  - `pnpm typecheck`.
  - Broader diff/app verification as practical after inspecting overlap.
- Expected outcomes:
  - Tests prove typing prewarm does not append mailbox, send read receipts, bind routes, start ensure-processing, or block a later mailbox send while prewarm is pending/in flight.
- Current focused results:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-linq-typing-prewarm.test.ts apps/web/test/hosted-orchestration-signal-runtime.test.ts` passed.
  - `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts --no-coverage test/hosted-orchestration-control.test.ts` passed.
  - `pnpm --dir packages/hosted-orchestrator-temporal exec vitest run --config vitest.config.ts --no-coverage test/ensure-runtime-processing.test.ts test/hosted-user-runtime-workflow.test.ts` passed.
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/index.test.ts` passed.
  - `pnpm typecheck` passed after replay-tolerance update.
  - `bash scripts/workspace-verify.sh test:diff ...` passed after replay-tolerance update, including Cloudflare verify and web verify.
  - Stale coverage-worker reports for scopeHash rejection and prewarm 5000ms timeout were rechecked in the parent worktree; both focused commands passed.
  - Final 5-agent audit drove fixes for single-attempt abandoned prewarm, workflow timeout slack, shared iMessage service normalization, queued-prewarm deadline handling, and no slow cleanup wait under the prewarm lifecycle lock.
  - Final focused reruns passed for Cloudflare runner/user-runner, Temporal workflow/entrypoint, hosted-execution signal parsing, hosted Linq typing prewarm, and root `pnpm typecheck`.
Completed: 2026-05-27

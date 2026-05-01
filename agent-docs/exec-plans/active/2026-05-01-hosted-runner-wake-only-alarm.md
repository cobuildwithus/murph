# Land hosted runner wake-only alarm cleanup

Status: active
Created: 2026-05-01
Updated: 2026-05-01

## Goal

- Land the supplied hosted runner cleanup intent on current `main`: keep runner nudges as the only `pending_nudge` writer, remove the remaining wait-for-idle runner RPC surface, and make alarms/recovery wakes observe, recover, or drain without manufacturing pending input.

## Success criteria

- `apps/cloudflare` no longer exposes `runWhenIdleOrBudget` on the Worker/DO stub surface.
- `DO.alarm()` drives `runUntilIdleOrBudget({ reason: "alarm", dueWake })` directly.
- Active or duplicate alarms only sync recovery alarms; they do not set `pending_nudge`.
- A nudge that arrives during an active invocation still exposes `inputAvailable` through heartbeat and starts a follow-up drive after the current invocation lock releases.
- Focused Cloudflare runner tests cover stale/duplicate alarm behavior and pending-nudge follow-up drive semantics.

## Scope

- In scope:
  - `apps/cloudflare/src/index.ts`
  - `apps/cloudflare/src/user-runner.ts`
  - `apps/cloudflare/src/worker-routes/shared.ts`
  - directly coupled Cloudflare runner tests and Workers test stubs
- Out of scope:
  - Hosted web nudge workflow changes
  - Assistant runtime mailbox import semantics
  - New nudge generation/protocol counters
  - Live Cloudflare deploy changes

## Constraints

- Technical constraints:
  - Preserve the direct DO nudge contract and watchdog-alarm fallback.
  - Do not reintroduce Cloudflare Queues for runner wake execution.
  - Durable Object alarms are recovery/drain signals only; real user/control-plane nudges are the only pending-input writer.
- Product/process constraints:
  - Preserve unrelated active dirty work in the checkout.
  - Follow high-risk Cloudflare runtime completion workflow with security/privacy, coverage, and final review passes.

## Risks and mitigations

1. Risk: removing `runWhenIdleOrBudget` could leave a test/runtime caller on the stale RPC.
   Mitigation: remove the method from the shared stub type and update focused tests/Workers harnesses so typecheck catches stragglers.
2. Risk: post-completion follow-up drives could recurse or overlap with the current invocation.
   Mitigation: queue a single in-memory follow-up drive and start it only after the invocation lock is released.
3. Risk: delayed watchdog scheduling could slow recovery for real pending work.
   Mitigation: real nudges still start direct idle drives immediately or surface active input via heartbeat; alarms remain a bounded retry/backstop.

## Tasks

1. Inspect current Cloudflare runner state against the supplied patch.
2. Remove the stale `runWhenIdleOrBudget` surface and route alarms to `runUntilIdleOrBudget`.
3. Add post-lock follow-up drive handling for pending nudges created during active invocations.
4. Update focused Cloudflare runner tests/stubs.
5. Run required verification and completion audit passes.
6. Close the plan and create a scoped commit.

## Decisions

- Current `main` already deleted `runner-wake-queue.ts` and no longer exports a Worker `queue` handler.
- Current `runUntilIdleOrBudget` already uses recovery-alarm sync while active, not `markPendingNudgeAndApplyAlarm`; the remaining cleanup is the wait-for-idle RPC surface plus follow-up-drive shape.

## Verification

- Commands to run:
  - focused Cloudflare runner tests
  - `pnpm --dir apps/cloudflare verify`
  - `pnpm typecheck`
  - `git diff --check`
- Expected outcomes:
  - All focused and required checks pass, or any unrelated pre-existing failure is named with evidence.

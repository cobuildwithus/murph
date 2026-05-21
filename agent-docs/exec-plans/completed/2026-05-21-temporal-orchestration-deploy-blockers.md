# Temporal Orchestration Deploy Blockers

## Goal

Close the remaining hosted Temporal deploy blockers from the main-branch final
review: web Temporal Cloud auth/TLS parity, demand-read resilience, stale demand
metadata cleanup, and the active-runtime recheck edge proof.

Success criteria:

- Hosted web Temporal signal client can connect with API-key auth and TLS
  material matching the worker-side Temporal environment.
- Per-user workflows survive transient `readRuntimeDemand` Activity exhaustion
  by recording compact metadata and waiting on a signal-aware retry timer.
- `requiresAiUsageDecision` is removed from the orchestration demand contract;
  web still gates by returning `blocked` demand.
- Workflow tests cover due `runtimeResultWakeAt` followed by `runtime_wake_sent`
  and final `runtime_completed(null)` before idle.
- Live docs describe the final demand contract without stale usage-decision
  metadata.

## Constraints

- Preserve unrelated hosted-local Temporal E2E work currently in the worktree.
- Do not expose local identifiers, secrets, raw payloads, provider data, or
  account-specific Temporal Cloud values.
- Keep completed execution-plan snapshots immutable.

## Working Set

- `apps/web/src/lib/hosted-orchestration/**`
- `apps/web/.env.example`
- `apps/web/test/hosted-orchestration-*.test.ts`
- `packages/hosted-execution/src/orchestration-control.ts`
- `packages/hosted-execution/src/parsers/orchestration-control.ts`
- `packages/hosted-execution/test/hosted-orchestration-control.test.ts`
- `packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts`
- `packages/hosted-orchestrator-temporal/test/hosted-user-runtime-workflow.test.ts`
- `packages/hosted-orchestrator-temporal/test/read-runtime-demand.test.ts`
- `agent-docs/references/hosted-temporal-orchestration.md`
- `agent-docs/index.md`

## Verification Plan

- Focused web Temporal client, web demand, hosted-execution contract, and
  Temporal workflow tests.
- Web, hosted-execution, and hosted-orchestrator typechecks.
- Root `pnpm typecheck`, docs/log guards, and scoped diff verification unless
  blocked by unrelated dirty work.

## Verification Results

- Focused hosted-execution, hosted-orchestrator Temporal, and hosted web
  orchestration tests passed.
- Hosted-execution, hosted-orchestrator Temporal, hosted web, root typecheck,
  docs drift, log guard, diff check, and scoped diff verification passed.
Status: completed
Updated: 2026-05-20
Completed: 2026-05-20

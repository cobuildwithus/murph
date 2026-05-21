# Hosted Temporal demand retry cleanup

## Goal

Close the remaining hosted Temporal demand/retry edge cases:

- Keep any mailbox backlog ahead of manual/browser/device demand.
- Keep failed runtime completions retryable through explicit workflow backoff metadata.
- Prevent stale workspace-wake suppression from being reintroduced after a newer signal.

## Scope

- `apps/web/src/lib/hosted-orchestration/runtime-demand.ts`
- `apps/web/test/hosted-orchestration-demand.test.ts`
- `packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts`
- `packages/hosted-orchestrator-temporal/src/workflow-types.ts`
- focused hosted Temporal workflow tests

## Constraints

- Temporal workflow state must stay pointer-only.
- Do not expose mailbox payloads, prompts, transcripts, user identifiers, local paths, provider responses, or secrets in tests or logs.
- Preserve unrelated dirty work in Murph Age and hosted-local MinIO harness files.

## Status

- Current checkout already has mailbox backlog priority and the system-lag/manual/usage-denied regression.
- Current checkout already schedules `runtime.failed` after failed runtime completion with no runtime next wake.
- Implemented: failed-completion retry delay is now an explicit workflow option, and stale workspace wake ignore-key updates are version-gated.

## Verification

- Focused hosted Temporal workflow/env/signal tests passed.
- Focused web orchestration demand/signal/client tests passed.
- `pnpm typecheck` passed.
- `pnpm test:diff ...` for the touched web/orchestrator slice passed, including `apps/web verify`.
- `pnpm test:smoke` passed.
Status: completed
Updated: 2026-05-21
Completed: 2026-05-21

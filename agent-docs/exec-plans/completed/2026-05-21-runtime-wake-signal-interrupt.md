# Runtime wake signal interrupt

## Goal

Fix the hosted Temporal workflow edge case where a signal that arrives while
`ensureCloudflareExecution` is awaited can be delayed when the execution result
is `runtime_wake_sent`.

Success criteria:

- A signal arriving during an execution await makes the workflow re-read demand
  immediately instead of sleeping through `recommendedRecheckAt`.
- Existing mailbox demand priority and failed-runtime completion retry behavior
  remain intact.
- Focused workflow tests prove the interleaving.

## Scope

- `packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts`
- `packages/hosted-orchestrator-temporal/test/hosted-user-runtime-workflow.test.ts`

## Constraints

- Keep Temporal state pointer-only.
- Do not expose mailbox payloads, prompts, transcripts, user identifiers, local
  paths, provider responses, or secrets in tests/logs.
- Preserve unrelated dirty work in the checkout.

## Status

- Confirmed all-mailbox-lag priority is already present in
  `apps/web/src/lib/hosted-orchestration/runtime-demand.ts`.
- Confirmed failed `runtime_completed` retry wake is already present.
- Fixed the `runtime_wake_sent` signal-arrival delay.

## Verification

- Focused workflow regression passed.
- `pnpm test:diff packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts packages/hosted-orchestrator-temporal/test/hosted-user-runtime-workflow.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm test:smoke` passed.
Status: completed
Updated: 2026-05-21
Completed: 2026-05-21

# Defer Hosted Usage Recording

## Goal

Land the provided patch as a clean PR that defers hosted assistant usage recording off the foreground assistant phase hot path while preserving usage-ledger writes and checkpoint ordering.

## Constraints

- Keep the change scoped to the existing hosted runtime usage-recording seam.
- Do not add a new persisted queue, scheduler, table, or reconciliation loop.
- Preserve fail-open behavior for usage-recording failures without blocking assistant progress.
- Preserve the existing web-owned usage ledger authority; Cloudflare/runtime remains a caller through the existing port.
- Use the PR-lane ReviewGPT loop to zero accepted findings before calling the PR merge-ready.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`

## Verification Plan

- Focused hosted runtime assistant-phase tests for deferred usage-record ordering and failure behavior.
- `pnpm test:diff` for the touched hosted-runtime files.
- `pnpm typecheck` unless a credibly unrelated blocker appears.
- ReviewGPT PR loop on the pushed PR head until zero accepted findings.
Status: completed
Updated: 2026-06-27
Completed: 2026-06-27

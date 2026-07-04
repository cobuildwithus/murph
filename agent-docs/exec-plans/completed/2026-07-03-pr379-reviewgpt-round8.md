# PR 379 ReviewGPT Round 8

## Goal

Fix the two ReviewGPT round-8 High findings for PR #379:

- Non-connect Junction connection-event backfills must keep a bounded delayed retry when their historical window is empty.
- Hosted hydration must not preserve stale local Junction historical-backfill metadata over newer hosted progress.

## Constraints

- Keep durable singleton `junctionHistoricalBackfill*` metadata owned by the connect-time historical backfill window only.
- Do not add a queue manager, new persisted state owner, or broad lifecycle abstraction.
- Use one structured merge predicate for hosted metadata, `nextReconcileAt`, observed-revision advancement, and reconciliation baseline selection.

## State

Round 8 confirmed the previous fixes preserved unpublished local progress, but still dropped non-connect event retries and used a prefix-only merge that could roll back newer hosted backfill progress.

## Done

- Round-7 fix committed and pushed in `3deec44caf`.
- Round-8 ReviewGPT artifact captured in `audit-packages/pr-379-reviewgpt-round-8.md`.

## Now

- Restore delayed per-job retry for empty non-connect backfill windows.
- Replace the broad metadata-prefix preservation check with causal Junction backfill progress comparison.

## Next

- Add regression coverage, run verification, commit, push, and rerun ReviewGPT.

## Working Set

- `packages/device-syncd/src/providers/junction.ts`
- `packages/device-syncd/test/junction-provider.test.ts`
- `packages/assistant-runtime/src/hosted-device-sync-runtime.ts`
- `packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts`
- `packages/device-syncd/src/store/hosted-account-hydration.ts`
Status: completed
Updated: 2026-07-03
Completed: 2026-07-03

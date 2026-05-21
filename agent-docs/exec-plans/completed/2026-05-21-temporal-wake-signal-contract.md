# Temporal Wake Signal Contract

## Goal

Make hosted Temporal runtime signals explicit at-least-once wake hints by removing unused command-style event identifiers from the signal contract and callers.

## Scope

- Shrink pure wake signal variants in `@murphai/hosted-execution`.
- Update web signal producers and lag sweeper callers.
- Update focused contract/workflow/web tests and the hosted Temporal ADR.

## Non-Goals

- Do not add workflow-level event-id dedupe or bounded LRU state.
- Do not change demand priority, workflow execution loop behavior, or Cloudflare adapter behavior.
- Do not migrate wake hints to Temporal Updates.

## Verification

- `pnpm --dir packages/hosted-execution test -- test/hosted-orchestration-control.test.ts`
- `pnpm --dir packages/hosted-orchestrator-temporal test -- test/hosted-user-runtime-workflow.test.ts test/signal-hosted-user-runtime.test.ts`
- `pnpm --dir apps/web test:prepared`
- `pnpm verify:acceptance`
- `pnpm --dir packages/assistant-runtime test:coverage`
- `pnpm --dir packages/cli test:coverage`

## Result

Pure manual/browser/device/lag Temporal signals are now kind-only wake hints.
Mailbox append signals still carry their mailbox pointer. The acceptance run
reported two coverage-lane timeouts under parallel load, but both affected full
package coverage lanes passed when rerun sequentially.
Status: completed
Updated: 2026-05-21
Completed: 2026-05-21

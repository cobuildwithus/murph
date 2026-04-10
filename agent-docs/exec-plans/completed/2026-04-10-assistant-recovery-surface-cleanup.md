# Assistant Recovery And Automation Surface Cleanup

## Goal

Make failed auto-reply recovery part of the ordinary automation pass contract so both local and hosted automation keep retry-safe failed receipts draining until idle, then simplify the public automation surface to match the daemon-backed continuous architecture.

## Scope

- `packages/assistant-engine/src/assistant/automation/**`
- `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`
- `packages/assistantd/{README.md,src/**,test/**}`
- `packages/assistant-cli/src/commands/assistant.ts`
- `packages/assistant-cli/test/**`
- `packages/cli/{config.schema.json,src/incur.generated.ts,test/**}`
- `ARCHITECTURE.md`
- coordination/plan artifacts for this lane

## Constraints

- Keep assistant automation a pure consumer of persisted captures and receipt state; do not invent a second durable assistant queue.
- Preserve the daemon requirement for continuous local automation.
- Keep one-shot automation daemon-free by default unless a caller opts into the daemon-backed continuous mode through the remaining explicit surface.
- Preserve unrelated dirty-tree edits, especially overlapping scheduler and iMessage work.

## Working Hypotheses

1. Startup-only recovery is the wrong abstraction because recovery candidates are just another runnable automation workload with retry deadlines.
2. Once recovery is folded into ordinary pass work, hosted and local paths can share the same correctness guarantees without special restart branches.
3. Removing `skipDaemon` after the behavior is unified will make the CLI, assistantd, and hosted semantics easier to reason about and easier to test.
Status: completed
Updated: 2026-04-10
Completed: 2026-04-10

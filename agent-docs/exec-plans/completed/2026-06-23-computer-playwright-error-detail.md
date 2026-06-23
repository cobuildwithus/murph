# Computer Playwright Error Detail

## Goal

Expose safe, actionable Playwright evaluation errors from hosted `computer_act`
back to the model so strict-mode violations, thrown errors, and stack traces are
debuggable without losing unknown-outcome safety.

## Constraints

- Keep Kernel credentials, live-view URLs, browser cookies/storage, tokens,
  typed sensitive input, and raw browser capabilities hidden from tool results,
  logs, fixtures, and docs.
- Preserve the existing `HOSTED_COMPUTER_EVAL_FAILED` unknown-outcome semantics:
  the model must observe run state before retrying Playwright code or taking the
  next browser step.
- Keep the change narrow across the existing web-owned Kernel adapter/service
  and assistant-engine dynamic tool formatting surfaces.
- No new persisted product state, scheduler, queue, or broader browser-control
  abstraction.

## Success Criteria

- A failed Kernel Playwright execution can carry a bounded, redacted exception
  detail to assistant-engine.
- The model-facing failed tool result includes the actionable detail alongside
  existing backend code/status and metadata.
- Focused tests cover detail propagation and redaction behavior.
- Required verification and completion audits pass or have documented unrelated
  blockers.

## Working Set

- `apps/web/src/lib/computer-use/kernel-client.ts`
- `apps/web/src/lib/computer-use/service.ts`
- `apps/web/src/lib/computer-use/runtime-log.ts`
- `apps/web/test/hosted-computer-kernel-client.test.ts`
- `apps/web/test/hosted-execution-computer-use.test.ts`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
- `packages/assistant-engine/test/assistant-codex-computer-tools.test.ts`
Status: completed
Updated: 2026-06-23
Completed: 2026-06-23

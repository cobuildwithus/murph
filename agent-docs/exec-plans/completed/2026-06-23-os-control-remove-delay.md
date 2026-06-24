# OS Control TypeText Delay Removal

## Goal

Remove model-controlled timing from hosted computer OS `typeText`.

Success criteria:

- `computer_os_control` `typeText` no longer accepts `delayMs`.
- Web calls Kernel `typeText` with instant typing and no model-controlled delay.
- Web tolerates and ignores legacy signed `typeText.delayMs` from old hosted runners during deploy skew.
- Focused schema, assistant-tool, Kernel-adapter, service, and runtime-log tests pass.

## Constraints/Assumptions

- Keep the OS-control fallback; do not redesign it into `computer_act` in this task.
- Preserve the existing security boundary: no screenshots, clipboard, raw Kernel handles, live-view URLs, or typed text in results/logs.
- Prefer deletion over a timing-budget abstraction.

## Key Decisions

- Omit Kernel's optional `delay` parameter instead of exposing a model-controlled delay knob.
- Keep model-facing schemas strict, but strip legacy `typeText.delayMs` only at the authenticated web callback boundary to avoid web/runner deploy skew.

## State

- Implementation complete. Focused verification and required audits passed; broader `test:diff` exposed an unrelated assistant-runtime pending-input scheduling failure.

## Done

- ReviewGPT finding triaged with Kernel docs.
- Removed `typeText.delayMs` from shared schema, assistant forwarding expectations, web Kernel adapter, and focused fixtures.
- Added schema/tool rejection tests for `typeText.delayMs`.
- Added signed-web-boundary compatibility for legacy `typeText.delayMs` and proof that `dragMouse.delayMs` is preserved.
- Security/privacy audit passed with no medium-or-higher findings.
- Coverage audit found no coverage gaps.
- Deep review found deploy-skew risk; fixed with authenticated boundary strip; rerun found no actionable findings.

## Now

- Finish scoped commit.

## Next

- None.

## Open questions

- None.

## Working set

- `packages/hosted-execution/src/computer-use.ts`
- `packages/hosted-execution/test/hosted-execution.test.ts`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
- `packages/assistant-engine/test/assistant-codex-computer-tools.test.ts`
- `apps/web/src/lib/computer-use/http.ts`
- `apps/web/src/lib/computer-use/kernel-client.ts`
- `apps/web/src/lib/computer-use/runtime-log.ts`
- `apps/web/src/lib/computer-use/service.ts`
- `apps/web/test/hosted-computer-http.test.ts`
- focused hosted computer-use tests
Status: completed
Updated: 2026-06-23
Completed: 2026-06-23

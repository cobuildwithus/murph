# Hosted typing ownership, late-start cleanup, and abort propagation

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

- Fix hosted typing ownership so Cloudflare only suppresses runtime fallback after a confirmed executor-owned start, while still cleaning up late-started Linq or Telegram typing handles at run teardown.

## Success criteria

- [x] Timed-out hosted typing starts return a cleanup-capable handle that does not claim runtime ownership.
- [x] Late Linq starts are not stopped immediately after timeout, but they are stopped when the hosted cleanup path calls `stop()`.
- [x] Telegram typing start honors the hosted abort deadline through the shared typing start helpers.
- [x] Focused regression tests cover the timeout/late-start ownership path plus the shared abort-link helper behavior.

## Scope

- In scope:
- `packages/assistant-runtime` hosted typing ownership and cleanup behavior
- `apps/cloudflare` runner ownership propagation for hosted typing
- `packages/assistant-engine` channel typing runtime helper cleanup
- `packages/operator-config` shared abort-link helper and Telegram typing start wiring
- Focused tests directly coupled to the touched typing/runtime surfaces
- Out of scope:
- Hosted notification ordering, unrelated wake/drain flow changes, or broader messaging-provider refactors

## Constraints

- Technical constraints:
- Preserve existing hosted typing start/stop logs unless the late-start timeout path now needs different cleanup semantics.
- Keep the change scoped to hosted typing ownership and abort wiring; do not widen into unrelated assistant-runtime or Cloudflare run-drain logic.
- Product/process constraints:
- Preserve overlapping in-flight hosted typing and assistant-runtime rows outside this specific ownership/cleanup slice.

## Risks and mitigations

1. Risk: A cleanup-only timeout handle could leak if the wrapper does not stop a late-resolving provider handle.
   Mitigation: Centralize late-start cleanup in the hosted handle wrapper and add regression coverage for stop-after-timeout behavior.
2. Risk: Ownership propagation changes could accidentally suppress runtime fallback or flip both sides on.
   Mitigation: Carry explicit `ownsRuntimeActivity` state through the hosted handle and cover the non-owning timeout path in tests.

## Tasks

1. Update the hosted typing handle/result shape so confirmed starts and cleanup-only timeout handles are distinct.
2. Route Cloudflare executor ownership off the explicit handle ownership flag instead of handle presence.
3. Move the shared abort-link helper into `@murphai/operator-config/http-retry` and reuse it in Linq and Telegram typing start paths.
4. Add focused regressions for late-start cleanup, ownership propagation, and Telegram abort wiring.

## Decisions

- Use cleanup-only hosted typing handles after timeout so run teardown still owns provider cleanup without suppressing runtime fallback.
- Keep the ownership bit on the hosted handle surface so both runtime and Cloudflare can use the same distinction.
- Bound cleanup-only `stop()` waits so a provider start that never settles cannot hang final teardown; continue best-effort cleanup in the background if the late start resolves after the cleanup timeout.

## Verification

- Commands to run:
- [x] `pnpm typecheck`
- [x] `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime/typing.ts packages/assistant-runtime/test/hosted-runtime-typing.test.ts packages/assistant-engine/src/assistant/channels/runtime.ts packages/assistant-engine/test/assistant-channels-runtime.test.ts packages/operator-config/src/http-retry.ts packages/operator-config/src/telegram-runtime.ts packages/operator-config/test/runtime-helpers.test.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-resume-finalize.test.ts agent-docs/exec-plans/active/2026-04-22-hosted-typing-late-start-cleanup.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- [x] `pnpm --dir packages/operator-config exec vitest run test/runtime-helpers.test.ts --config vitest.config.ts --no-coverage`
- [x] `pnpm --dir packages/assistant-engine exec vitest run test/assistant-channels-runtime.test.ts --config vitest.config.ts --no-coverage`
- [x] `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-typing.test.ts --config vitest.config.ts --no-coverage`
- [x] `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/user-runner-resume-finalize.test.ts --no-coverage`
- [x] `pnpm test:smoke`
- [x] `git diff --check`
- Expected outcomes:
- Typecheck passes, the diff-aware lane truthfully covers the touched owners, and the new timeout/late-start typing regressions stay green.
Completed: 2026-04-22

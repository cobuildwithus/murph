# PR 213 ReviewGPT Round 8 Fixes

Status: completed
Created: 2026-06-18
Updated: 2026-06-18

## Goal

- Resolve accepted ReviewGPT findings for PR 213 with the smallest durable changes.

## Success Criteria

- `finish_without_reply` cannot leave suppressed model text visible in CLI streaming/progress surfaces.
- Native Codex resume state is invalidated as soon as a no-reply action makes provider history unsafe, including failure and policy-rejection paths.
- Required-send notification turns do not advertise or accept `finish_without_reply`.
- One-variant reaction-era abstractions are collapsed where they create real synchronization complexity without widening scope unnecessarily.
- Focused tests and scoped verification pass, then the PR branch is committed and pushed.

## Scope

- In scope: assistant Codex final-action handling, trace/progress streaming suppression, Codex resume invalidation, notification no-reply policy, and directly related tests/types.
- Out of scope: unrelated hosted notification cleanup, broad assistant-runtime refactors, or new persisted state.

## Constraints

- Prefer deletion and direct value flow over new managers or compatibility layers.
- Keep fixes at existing assistant/provider/CLI boundaries.
- Preserve unrelated work and active ledger rows.

## Risks And Mitigations

1. Risk: hidden no-reply text reaches user-visible streaming before final suppression.
   Mitigation: suppress/remove visible trace output for the affected delivery context and reject no-reply if output already escaped.
2. Risk: unsafe native Codex history remains resumable after failure.
   Mitigation: invalidate resume state immediately when no-reply is accepted and propagate unsafe-history state through failures.
3. Risk: simplification churn grows beyond the bug.
   Mitigation: collapse only one-variant structures that are directly in the PR's final-action/outbox delivery path.

## Tasks

1. Inspect current PR head and tests for no-reply streaming/resume behavior. Done.
2. Patch streaming suppression and unsafe resume invalidation. Done.
3. Patch required-send notification tool availability. Done.
4. Collapse accepted one-variant abstractions where simple and local. Done.
5. Add focused regressions and run scoped verification. Done.
6. Run required local audits, commit with `scripts/finish-task`, push, and continue ReviewGPT loop if requested. Done.

## Verification

- `pnpm --filter @murphai/assistant-engine typecheck`
- `pnpm --filter @murphai/assistant-engine test -- assistant-codex-runtime.test.ts assistant-local-service-runtime.test.ts assistant-notification-turn-runtime.test.ts assistant-service-runtime.test.ts assistant-codex-final-coverage.test.ts assistant-protocol-index-planning.test.ts`
- `pnpm --filter @murphai/assistant-cli typecheck`
- `pnpm --filter @murphai/assistant-cli test -- assistant-ui-state-view-model.test.ts`
- `pnpm --filter @murphai/hosted-execution typecheck`
- `pnpm --filter @murphai/hosted-execution test -- side-effects.test.ts side-effects-subject.test.ts hosted-execution-observability-side-effects.test.ts`
- `pnpm --filter @murphai/assistant-runtime typecheck`
- `pnpm --filter @murphai/assistant-runtime test -- hosted-email-subject.test.ts hosted-runtime-callbacks.test.ts hosted-runtime-workspace-assistant-phase.test.ts`
- `pnpm --filter @murphai/assistant-engine... build`
- Local security/privacy, coverage, and deep-review audits completed; the deep-review recheck found no remaining medium-or-higher issues.
Completed: 2026-06-18

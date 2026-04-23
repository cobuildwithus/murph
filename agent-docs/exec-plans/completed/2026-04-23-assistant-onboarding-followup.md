# Fix onboarding guidance injection, state-reader failure modes, and no-command completion fallback

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Keep conversation onboarding durable and truthful after the lifecycle redesign by decoupling onboarding guidance from bootstrap replay/native resume, hardening onboarding-state reads so corrupt runtime files do not silently reopen onboarding, and adding a narrow no-command fallback so obvious onboarding-complete replies stop paying repeated prompt tax.

## Success criteria

- Resumed native provider sessions still inject onboarding guidance while onboarding remains open, but bootstrap-only context stays disabled on native resume.
- Completion turns stop injecting onboarding guidance on the next turn after onboarding is completed.
- Missing onboarding state still defaults to open, while malformed or unreadable onboarding state no longer silently reopens.
- Routes without an assistant command surface can still settle clear onboarding-complete turns through a narrow runtime fallback.
- Focused assistant-engine verification, required completion audits, and a scoped commit all complete without widening into unrelated assistant/runtime work.

## Scope

- In scope:
- `packages/assistant-engine/src/assistant/{onboarding-state,turn-plan,provider-turn-runner,system-prompt,local-service,delivery-service,service-contracts}.ts`
- Directly coupled `packages/assistant-engine/test/**` coverage for onboarding continuity, state reading, provider-turn execution, prompt copy, and local-service finalization.
- Out of scope:
- Assistant CLI contract/schema churn outside directly coupled onboarding-state behavior.
- Provider failover, hosted runtime execution, or channel delivery behavior unrelated to onboarding continuity/finalization.
- Larger transcript-intent parsing or broader onboarding state-machine redesigns.

## Constraints

- Technical constraints:
- Preserve the split between durable onboarding lifecycle state and first-contact dedupe state.
- Keep the no-command fallback narrow and deterministic; do not add a broad transcript parser or new persisted schema.
- Avoid touching unrelated dirty-tree work, especially the active hosted typing/message-retention rows.
- Product/process constraints:
- Follow the standard repo-change workflow: scoped verification, required `coverage-write`, required `task-finish-review`, then `scripts/finish-task`.
- Do not silently weaken malformed-state failures back to “open”; explicit operator repair/reopen remains the recovery path.

## Risks and mitigations

1. Risk: Renaming leftover onboarding symbols could widen across assistant-engine surfaces.
   Mitigation: Keep the rename package-local, limit it to directly coupled runtime/test seams, and avoid public package-boundary churn unless strictly required.

2. Risk: Failing closed on corrupt onboarding state could block onboarding reads or commands unexpectedly.
   Mitigation: Keep missing-file behavior fail-open, surface a precise read error for corrupt state, and let explicit reopen/complete writes overwrite corrupt state intentionally.

3. Risk: The no-command fallback could over-classify normal chat as onboarding completion.
   Mitigation: Restrict fallback heuristics to obvious `concrete_request`, `user_answered`, and `user_declined` turns only when onboarding guidance was actually injected and no command surface is available.

## Tasks

1. Replace bootstrap-coupled onboarding injection with a separate onboarding-guidance decision and truthful symbol names.
2. Harden onboarding-state reads so only missing files default open, while corrupt/unreadable files surface an explicit error.
3. Add a narrow runtime fallback for no-command routes so clear onboarding-complete turns settle without tool access.
4. Update focused assistant-engine tests and prompt expectations for the new behavior.
5. Run scoped verification, required audit passes, and finish the task with a scoped commit.

## Decisions

- Keep first-contact dedupe as a separate concern from onboarding lifecycle state.
- Prefer explicit malformed-state failure over silent reopen, with explicit operator overwrite commands as the recovery path.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:diff packages/assistant-engine/src/assistant/onboarding-state.ts packages/assistant-engine/src/assistant/turn-plan.ts packages/assistant-engine/src/assistant/provider-turn-runner.ts packages/assistant-engine/src/assistant/system-prompt.ts packages/assistant-engine/src/assistant/local-service.ts packages/assistant-engine/src/assistant/delivery-service.ts packages/assistant-engine/src/assistant/service-contracts.ts packages/assistant-engine/test/assistant-onboarding-state.test.ts packages/assistant-engine/test/onboarding-injection.test.ts packages/assistant-engine/test/provider-continuity.test.ts packages/assistant-engine/test/provider-turn-runner.test.ts packages/assistant-engine/test/system-prompt.test.ts packages/assistant-engine/test/assistant-local-service-runtime.test.ts packages/assistant-engine/test/assistant-service-runtime.test.ts packages/assistant-engine/test/assistant-store-runtime.test.ts`
- Required `coverage-write` and `task-finish-review` audit passes after implementation.
- `bash scripts/finish-task agent-docs/exec-plans/active/2026-04-23-assistant-onboarding-followup.md "<summary>" <paths...>`
- Expected outcomes:
- Focused assistant-engine checks cover the onboarding follow-up slice truthfully.
- Required audits find no remaining blocking gaps.
- The task lands as a scoped commit without touching unrelated dirty-tree files.
Completed: 2026-04-23

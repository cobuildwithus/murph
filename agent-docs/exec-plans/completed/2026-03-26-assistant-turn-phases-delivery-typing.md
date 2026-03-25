# Assistant turn phases and delivery typing

Status: completed
Created: 2026-03-26
Updated: 2026-03-26

## Goal

- Refactor the assistant message-send path into explicit, typed phases and replace ad hoc outbound delivery return-shape inspection with a stable internal contract, without changing observable behavior.

## Success criteria

- `sendAssistantMessage()` is split into small helpers with clear phase boundaries for session resolution, transcript persistence, provider execution/recovery, session persistence, and optional delivery.
- The assistant service no longer checks outbound results with `'delivery' in ...` or `'session' in ...` probes.
- `deliverAssistantMessageOverBinding()` has an explicit return type that makes the expected adapter result contract obvious.
- `assistantAskResultSchema.parse(...)` output shape and existing delivery failure semantics stay unchanged.
- Existing provider-session recovery, onboarding injection, transcript replay, and post-provider persistence behavior remain pinned by focused tests.

## Scope

- In scope:
  - `packages/cli/src/assistant/service.ts`
  - `packages/cli/src/outbound-channel.ts`
  - focused assistant service/runtime tests needed to pin the typed delivery contract
- Out of scope:
  - changing user-visible assistant output or command contracts
  - changing outbound adapter behavior
  - changing assistant UI, command routing, or storage schema

## Constraints

- Preserve current persistence timing and failure semantics, especially keeping provider success/session updates even when delivery fails.
- Preserve the current resumable-provider recovery rule for recovered provider-session ids.
- Preserve current first-turn onboarding injection and local transcript replay policy.
- Keep the refactor local to assistant service/delivery typing; prefer private helpers over new abstraction layers.

## Risks and mitigations

1. Risk: refactoring `sendAssistantMessage()` drifts provider/session persistence ordering.
   Mitigation: extract helpers around the current order of operations rather than redesigning the flow, and keep focused regression coverage on provider/session side effects.
2. Risk: explicit delivery typing accidentally narrows an adapter result shape that callers currently tolerate.
   Mitigation: model the current normalized possibilities in one place, keep outward service results unchanged, and add a focused delivery-contract test if needed.
3. Risk: active overlapping assistant lanes in `assistant/service.ts`.
   Mitigation: preserve adjacent recovery-related edits already present in the tree and keep the change scoped to phase extraction plus delivery result normalization.

## Tasks

1. Capture the current service and outbound delivery behavior from code and focused tests.
2. Introduce typed private helpers for assistant turn planning, transcript persistence, provider execution/recovery, session persistence, and delivery normalization.
3. Give `deliverAssistantMessageOverBinding()` an explicit return type and centralize adapter-output normalization in the service or outbound layer.
4. Update focused tests only where the refactor makes the previously implicit delivery contract explicit.
5. Run focused verification plus the required audit passes for this lane and record exact outcomes.

## Verification

- Focused commands:
  - `pnpm exec vitest --configLoader runner run packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest --configLoader runner run packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-runtime.test.ts packages/cli/test/assistant-channel.test.ts --no-coverage --maxWorkers 1`
- Broader commands if the tree remains compatible:
  - `pnpm typecheck`
- Audit passes:
  - simplify
  - test-coverage audit
  - task-finish review

## Outcome

- Split `sendAssistantMessage()` into explicit phase helpers for turn planning, user-turn persistence, provider execution/recovery, assistant-turn/session persistence, and optional delivery.
- Replaced ad hoc outbound result probing in the service with a typed `AssistantDeliveryOutcome` flow.
- Gave `deliverAssistantMessageOverBinding()` an explicit `DeliverAssistantMessageOverBindingResult` contract and normalized it to always return `{ delivery, session? }`.
- Preserved the public `assistantAskResultSchema` result shape and the current semantics where provider success/session persistence survive outbound delivery failures.
- Left focused tests unchanged because the existing service/runtime/channel coverage already pinned the relevant behavior after the refactor.

## Verification results

- Passed:
  - `pnpm exec vitest --configLoader runner run packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest --configLoader runner run packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-runtime.test.ts packages/cli/test/assistant-channel.test.ts --no-coverage --maxWorkers 1`
- Failed for pre-existing reasons outside this refactor:
  - `pnpm typecheck`
    - fails in `packages/core` before reaching this assistant slice, including missing built-contract artifacts (`TS6305` under `packages/core/**`) and existing provider typing errors in `packages/core/src/bank/providers.ts`.
- Audit pass notes:
  - Simplify: no additional behavior-preserving cleanup was warranted after the phase extraction and typed delivery normalization.
  - Test-coverage audit: existing `assistant-service`, `assistant-runtime`, and `assistant-channel` suites already cover the refactored delivery/session contracts and failure semantics.
  - Task-finish review: no new correctness or security findings were identified in the touched assistant service/outbound code; residual risk remains limited to the broader red workspace state outside this lane.

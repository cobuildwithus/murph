# Reduce execution-context complexity

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Goal

Reduce concentrated branching in `packages/assistant-engine/src/assistant/execution-context.ts` while preserving accepted inputs, outputs, diagnostics, ordering and existing ownership.

## Evidence and owner

The repository analyzer at base `56b9f3751977b5b6745269f1a444559d5ef91ce0` reports normalizeAssistantExecutionContext at complexity 85. The existing module remains the implementation owner. No schema, authority, state or deployment contract changes are intended.

## Approach

Inspect the implementation patch, prioritize deleted repetition and existing primitives, and use narrowly named same-file helpers only for real responsibilities. Preserve failure and retry behavior. Record both excess-over-20 debt and total complexity to distinguish factoring from branch deletion.

## Tasks

1. Inspect the proposed patch and callers; confirm behavior preservation.
2. Run focused owner tests, relevant typecheck, differential proof where useful, and the complexity guard.
3. Review the complete diff, close this plan in the scoped commit, and open a draft PR with concrete evidence.
4. Mark the stable candidate Ready; start final ReviewGPT concurrently with required exact-head CI and resolve the completion gates.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-service-runtime.test.ts test/assistant-prompt-capability-availability.test.ts`: 77 tests passed.
- `pnpm --filter @murphai/assistant-engine typecheck`: passed.
- `pnpm test:assistant:live -- --test "normalized hosted context stops .*WHOOP.* check-ins while keeping sync connected" --codex-home <AUTHENTICATED_SUBSCRIPTION_HOME>`: passed on gpt-5.6-terra through local subscription. Exactly one configure_no_data_outreach/off call; no disconnect or other effect. Parent reply review: Ready. Authentication/quota failures on earlier profiles occurred before provider action.
- `pnpm complexity:diff --base 56b9f3751977b5b6745269f1a444559d5ef91ce0`: passed.
- `git diff --check`: passed.
- Parent inspected the complete source and regression-test diff; no private data, new dependencies or public API changes.

## Outcome

Hosted execution context normalization repeated optional access and field-presence decisions throughout a large return object. Guard absent context once and reuse one typed optional-field helper while retaining port validation, binding, omission and field order.

normalizeAssistantExecutionContext 85 → 18; file maximum 85 → 18; excess-over-20 debt delta -65; total function complexity delta -65.

The changed responsibility now fits below the threshold; unchanged neighboring policies remain separately scoped. No functions above 20 remain in this source file.

Final ReviewGPT and exact-head CI are tracked in the PR after this scoped commit. Internal behavior-preserving refactor; no changelog or deployment contract change.
Completed: 2026-09-14

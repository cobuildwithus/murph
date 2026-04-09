# Codex Stale Resume Recovery

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Make Murph recover automatically when a saved Codex native-resume session is no longer valid, instead of failing the turn with a bare `EPIPE`.

## Success criteria

- A stale Codex resume failure is classified from the child process' real exit/stderr rather than collapsing into `write EPIPE`.
- Murph retries the same turn once without the stale `resumeProviderSessionId`.
- Successful fresh retries persist the new provider session normally so later turns resume again.
- The stale saved resume state is not reused on the next turn after a stale-resume failure.
- Focused regression coverage proves the stale-resume path and preserves normal resume behavior.

## Scope

- In scope:
- `packages/assistant-engine` Codex wrapper, Codex provider retry logic, and recovery/error classification seams
- focused CLI/engine tests that cover stale resume recovery
- Out of scope:
- proactive Codex-home stamping or schema changes
- broader continuity-model redesign

## Constraints

- Keep native Codex resume as the default steady-state behavior.
- Minimize architecture churn: prefer best-effort resume plus same-turn fresh fallback over new persisted identity fields.
- Preserve unrelated in-flight assistant-engine and CLI edits.

## Risks and mitigations

1. Risk: Fresh fallback could hide unrelated provider failures.
   Mitigation: only retry on explicit stale-resume classification, not on generic provider errors.
2. Risk: Early stdin errors could still race the child exit and lose the real stderr.
   Mitigation: make the Codex wrapper prefer close/exit diagnostics when a resumed child dies before stdin completes.
3. Risk: Retry logic could recurse or double-send.
   Mitigation: limit stale-resume recovery to one fresh retry in the same provider turn attempt and keep delivery after provider success only.

## Tasks

1. Update the Codex wrapper to classify stale-resume failures from close/stderr instead of surfacing raw stdin `EPIPE`.
2. Add a narrow stale-resume error code and detection helper.
3. Retry once without `resumeProviderSessionId` when that stale-resume code is raised.
4. Let successful fresh retries overwrite the stale saved provider session id through the normal session persistence path.
5. Add focused regression tests.
6. Run required verification and the required final audit pass.

## Decisions

- Prefer reactive stale-resume recovery over proactive Codex-home fingerprinting for now.
- Keep the persisted session schema unchanged in this patch.

## Verification

- Commands to run:
- `pnpm --filter @murphai/assistant-engine test -- assistant-codex-runtime.test.ts provider-execution.test.ts`
- `pnpm --filter @murphai/assistant-engine typecheck`
- `pnpm exec tsx --eval "...executeCodexPrompt({ resumeSessionId: <stale-id> ... })..."` against the real local Codex CLI
- Expected outcomes:
- stale Codex resumes classify as `ASSISTANT_CODEX_RESUME_STALE`, the provider retries once fresh, and the touched runtime/tests pass.
Completed: 2026-04-09

# Codex Resume Instruction Overrides

## Goal

Preserve user session continuity when Murph's stable Codex instructions change.

Success criteria:

- Ordinary resume still sends only `threadId` and `excludeTurns: true`.
- Existing route binding remains the resume safety boundary.
- Murph does not add cwd fingerprints or start fresh solely because the stable instruction fingerprint changed.
- Focused tests cover thin resume request shaping and resumed instruction-refresh planning.

## Scope

- `packages/assistant-engine/src/assistant-codex/app-server-requests.ts`
- `packages/assistant-engine/src/assistant/provider-turn/planning.ts`
- Focused assistant-engine tests for Codex resume request shaping and planning.

## Constraints

- Preserve unrelated dirty work in the checkout.
- Do not print or persist raw prompts, local account identifiers, home paths, secrets, or authorization values.
- Keep existing route-id resume binding behavior.

## Verification

- Passed: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-codex-runtime.test.ts test/assistant-protocol-index-planning.test.ts test/provider-seams.test.ts test/turn-finalizer.test.ts`.
- Passed: `pnpm --dir packages/operator-config exec vitest run --config vitest.config.ts test/assistant-session-resume-state.test.ts`.
- Passed: `pnpm --dir packages/assistant-engine typecheck`.
- Passed: `pnpm --dir packages/operator-config typecheck`.
- Passed: `git diff --check` for touched resume-policy files.
- Blocked by unrelated dirty worktree state: `pnpm typecheck` and scoped `test:diff` fail on existing `apps/cloudflare/src/hosted-env-policy.ts` workspace-boundary issues and `packages/assistant-runtime/src/hosted-runtime/codex-config.ts` importing a missing `ASSISTANT_CODEX_MODEL_PROVIDER_IDS` export.

## State

- Done: follow-up plan opened.
- Done: removed cwd fingerprint persistence and instruction-drift fresh-start behavior from this change.
- Done: ordinary resume request shaping remains thin.
- Now: close plan without commit because overlapping unrelated dirty work blocks a safe scoped commit.
- Next: handoff.
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05

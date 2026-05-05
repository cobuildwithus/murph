# Thin Codex Resume Params

## Goal

Stop sending runtime/config fields on ordinary Codex `thread/resume` requests.

Success criteria:

- Ordinary `thread/resume` RPC params contain only `threadId` and `excludeTurns: true`.
- If the saved route/instruction fingerprint no longer matches the current route, use a fresh thread instead of trying to mutate the resumed thread.
- Focused assistant-engine tests cover the request builder and planning behavior.

## Scope

- `packages/assistant-engine/src/assistant-codex/app-server-requests.ts`
- `packages/assistant-engine/src/assistant/provider-turn/planning.ts`
- Focused assistant-engine tests for Codex resume request shaping and resume planning.

## Constraints

- Preserve unrelated dirty work in the checkout.
- Do not log or fixture raw prompts, request bodies, local account identifiers, home paths, or secrets.
- Keep Codex `thread/start` behavior unchanged.

## Verification

- Passed: focused assistant-engine Codex runtime/planning tests.
- Passed: `pnpm typecheck`.
- Passed after security-audit fixes: `pnpm --dir packages/assistant-engine test:coverage`.
- Passed after shared-contract fix: `pnpm --dir packages/operator-config test:coverage`.
- Passed after replay-scope fix: `pnpm typecheck`.
- Passed after replay-scope fix: `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant-codex/app-server-requests.ts packages/assistant-engine/src/assistant/local-service.ts packages/assistant-engine/src/assistant/provider-binding.ts packages/assistant-engine/src/assistant/provider-state.ts packages/assistant-engine/src/assistant/provider-turn/planning.ts packages/assistant-engine/src/assistant/turn-finalizer.ts packages/assistant-engine/test/assistant-codex-runtime.test.ts packages/assistant-engine/test/assistant-protocol-index-planning.test.ts packages/assistant-engine/test/provider-seams.test.ts packages/assistant-engine/test/turn-finalizer.test.ts packages/operator-config/src/assistant-cli-contracts.ts packages/operator-config/test/assistant-session-resume-state.test.ts`.

## State

- Done: scoped plan opened.
- Done: ordinary `thread/resume` params now carry only `threadId` and `excludeTurns`.
- Done: changed/missing thread-instruction or working-directory fingerprints now plan a fresh thread instead of resumed-thread mutation.
- Done: resume state now stores a hash-only working-directory fingerprint for future resume proof.
- Done: fresh-thread transcript replay is capped and limited to session-thread fallback.
- Done: focused tests, typecheck, assistant-engine coverage, and operator-config coverage passed.
- Done: final local review, whitespace check, and scoped diff verification passed.
- Now: archive plan; scoped commit blocked by overlapping dirty files in the same touched test/planning files.
- Next: handoff with verification summary.
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05

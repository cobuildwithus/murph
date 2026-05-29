# Assistant Progress Tool Contract

## Goal

Validate and fix the assistant progress-tool contract so model-authored progress is exposed only on eligible user-facing turns, delivery status is explicit, and resume/stub tests match the implemented Codex app-server behavior.

## Constraints

- Keep the shape simple and local to assistant turn/progress plumbing.
- Do not weaken assistant runtime privacy, delivery idempotency, or outbox invariants.
- Preserve best-effort progress delivery as an ephemeral current-audience side effect.
- Do not touch unrelated hosted-runtime or CLI dirty work.

## Plan

1. Verify each reported issue against current implementation and tests.
2. Use subagents for independent resume/stub and progress-semantics review.
3. Patch only confirmed issues with focused tests.
4. Run focused assistant-engine/assistant-runtime verification plus typecheck unless blocked by unrelated failures.
5. Run required completion audits and land a scoped commit if safe.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-runtime.test.ts test/assistant-turn-progress.test.ts test/assistant-notification-turn-runtime.test.ts`: passed.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-codex-config.test.ts`: passed.
- `pnpm --dir packages/assistant-engine typecheck`: passed.
- `pnpm --dir packages/assistant-runtime typecheck`: passed.
- `pnpm typecheck`: passed.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/turn-progress.ts packages/assistant-engine/src/assistant/delivery-service.ts packages/assistant-engine/src/assistant-codex.ts packages/assistant-engine/src/assistant-codex/app-server-requests.ts packages/assistant-engine/src/assistant/codex-turn/planning.ts packages/assistant-engine/src/assistant/notification-turn.ts packages/assistant-engine/src/assistant/providers/codex-cli.ts packages/assistant-engine/test/assistant-turn-progress.test.ts packages/assistant-engine/test/assistant-codex-runtime.test.ts packages/assistant-engine/test/assistant-notification-turn-runtime.test.ts packages/assistant-runtime/src/hosted-runtime/codex-e2e-app-server-stub.ts packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts`: passed.
- `git diff --check`: passed.
Status: completed
Updated: 2026-05-28
Completed: 2026-05-28

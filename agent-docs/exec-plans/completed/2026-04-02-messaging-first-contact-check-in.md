# Messaging first-contact check-in

## Goal

Extend the existing prompt-only first-chat onboarding so Murph also gives the same brief first-contact welcome/check-in on the first reply over supported user-facing messaging channels.

## Why

- The current implementation only opts local interactive chat into the first-turn check-in.
- Real user first contact commonly happens over Telegram, email, iMessage, or Linq.
- The onboarding should remain prompt-only and brief, without restoring separate onboarding persistence.

## Scope

- Detect first-turn user-facing messaging replies in the assistant turn planner.
- Keep local chat opt-in behavior intact.
- Exclude unrelated outbound flows such as cron broadcasts from the onboarding injection.
- Update focused assistant tests for messaging-channel first-contact behavior.

## Non-goals

- Do not restore `onboarding.json` or slot extraction.
- Do not change assistant memory storage format or persistence semantics.
- Do not broaden the onboarding into a longer interview.

## Verification

- Focused first-contact scenario proof for messaging replies.
- Focused assistant service/runtime tests covering messaging first turn and cron exclusion.
- Repo-required `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.

## Outcome

- First-turn onboarding injection now applies to supported user-facing messaging replies in addition to the existing local interactive chat path.
- Messaging onboarding is now explicit at the caller boundary: local interactive chat and inbound auto-reply flows opt in, while proactive delivered outbound turns do not infer onboarding just from using a messaging channel.
- Cron-driven outbound deliveries remain excluded.
- The old onboarding persistence path stays removed; this change is prompt-only.

## Verification notes

- Passed: `pnpm exec vitest run --coverage.enabled=false packages/cli/test/assistant-service.test.ts -t "first-chat check-in"`
- Passed: `pnpm exec vitest run --coverage.enabled=false packages/cli/test/assistant-runtime.test.ts -t "first-contact check-in"`
- Failed for unrelated in-flight assistant/config worktree changes: `pnpm typecheck`
  - current top blockers include `packages/assistant-core/src/assistant/local-service.ts` missing `AssistantSession` and the existing assistant config/setup breakage in `packages/assistant-core/src/assistant/service-turn-routes.ts`, `packages/assistant-core/src/assistant/session-resolution.ts`, and `packages/cli/src/setup-services.ts`
- Failed for unrelated in-flight assistant/config worktree changes: `pnpm test`
  - current failures remain in the existing assistant provider/operator-config lanes plus downstream fallout in assistant runtime/setup coverage
- Failed for unrelated workspace/app issues in addition to the same assistant/config breakage: `pnpm test:coverage`
  - current additional blockers include `apps/web` dev-smoke timeout and a Vitest worker startup timeout in `apps/web/test/hosted-onboarding-stripe-event-queue.test.ts`

Status: completed
Updated: 2026-04-02
Completed: 2026-04-02

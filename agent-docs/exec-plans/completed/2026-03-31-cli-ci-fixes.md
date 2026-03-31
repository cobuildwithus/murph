## Goal

Clear the current `main` CI failures in `Murph Host Support` and `release:check` without changing intended runtime behavior.

## Scope

- Fix the `packages/cli/test/gateway-local-service.test.ts` type mismatch against the local gateway send helper.
- Fix Linux-specific inbox/setup test expectations in `packages/cli/test/inbox-cli.test.ts` and `packages/cli/test/setup-cli.test.ts`.
- Repair the two `assistant cron target` smoke scenario fixtures so repo-wide smoke verification recognizes the new command surface entries.
- Preserve existing macOS-only iMessage behavior and the current apt resolution logic.

## Constraints

- Keep the diff narrowly scoped to the failing CLI tests.
- Do not alter unrelated gateway/runtime behavior.
- Use full repo verification before handoff.

## Verification

- `pnpm --dir packages/cli test`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Outcome

- Restored the Ubuntu-only CLI test expectations without changing runtime behavior.
- Aligned the gateway local-service test with the helper signature that actually accepts `dispatchMode`.
- Updated the `assistant-cron-target-{set,show}` smoke scenarios to the current fixture schema so root smoke integrity and coverage verification pass again.
Status: completed
Updated: 2026-03-31
Completed: 2026-03-31

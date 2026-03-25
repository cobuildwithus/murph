# Auto-Reply Stall Watchdog

## Goal

Stop assistant auto-reply turns from hanging forever when the provider/tool bridge goes silent mid-turn, while preserving resumable provider sessions and retrying the same capture instead of dropping it.

## Scope

- Add an automation-side heartbeat/inactivity watchdog around auto-reply provider turns.
- Surface safe heartbeat/stall status lines in `healthybob run`.
- Classify stalled turns as deferred retries so the auto-reply cursor does not advance.
- Add focused regression coverage for stall retry/session preservation and safe terminal formatting.

## Constraints

- Keep the change scoped to auto-reply automation; do not reshape interactive chat behavior.
- Preserve existing reconnect/session-recovery behavior and transcript/delivery semantics.
- Avoid broad provider/runtime refactors when a local automation watchdog is sufficient.

## Verification Plan

- Run focused assistant Vitest coverage for the auto-reply scanner, terminal logging, and provider/session recovery paths.
- Run repo-required `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`, and record exact blockers if unrelated red lanes remain.

## Status

Implemented in this clone. Auto-reply turns now emit heartbeat/stall status progress, abort after a sustained no-progress window, preserve the recovered provider session, and leave the capture queued for retry.

## Verification Notes

- `pnpm vitest run --coverage.enabled=false packages/cli/test/assistant-runtime.test.ts packages/cli/test/assistant-cli.test.ts packages/cli/test/assistant-service.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed after adding this active plan file for the docs-drift gate.
- `pnpm test:coverage` now reaches the final repo coverage pass and fails on an unrelated pre-existing branch threshold miss in `packages/core/src/vault.ts` (77.04% vs the 80% threshold).

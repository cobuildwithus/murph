# Auto-Reply Stall Watchdog

## Goal

Stop assistant auto-reply turns from hanging forever when the provider/tool bridge goes silent mid-turn, while preserving resumable provider sessions and retrying the same capture instead of dropping it.

## Scope

- Add an automation-side heartbeat/inactivity watchdog around auto-reply provider turns.
- Surface safe heartbeat/stall status lines in `healthybob run`.
- Classify stalled turns as deferred retries so the auto-reply cursor does not advance.
- Add focused regression coverage for stall retry/session preservation and safe terminal formatting.
- Refine the watchdog so long-running `research`/`deepthink` CLI tool calls can run for their expected duration without being misclassified as silent stalls.

## Constraints

- Keep the change scoped to auto-reply automation; do not reshape interactive chat behavior.
- Preserve existing reconnect/session-recovery behavior and transcript/delivery semantics.
- Avoid broad provider/runtime refactors when a local automation watchdog is sufficient.
- Preserve fast retry behavior for ordinary short tool calls that wedge without progress.

## Verification Plan

- Run focused assistant Vitest coverage for the auto-reply scanner, terminal logging, and provider/session recovery paths.
- Run repo-required `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`, and record exact blockers if unrelated red lanes remain.

## Status

Implemented in this clone. Auto-reply turns emit heartbeat/stall status progress, abort after a sustained no-progress window, preserve the recovered provider session, leave the capture queued for retry, and now keep explicit long-running `research`/`deepthink` CLI runs on a separate longer stall window.

## Verification Notes

- `pnpm vitest run --coverage.enabled=false packages/cli/test/assistant-runtime.test.ts packages/cli/test/assistant-cli.test.ts packages/cli/test/assistant-service.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm exec vitest run packages/cli/test/assistant-runtime.test.ts packages/cli/test/assistant-cli.test.ts --coverage.enabled=false` passed after adding long-running `deepthink` watchdog coverage.
- `pnpm test` failed for unrelated pre-existing repo issues outside this patch:
  - six existing `packages/cli/test/health-tail.test.ts` failures/timeouts
  - existing `packages/cli` build/type boundary failures during the built-CLI path (`TS6059` / `TS6307` rootDir/file-list errors against sibling workspace source imports)
- `pnpm test:coverage` failed for an unrelated pre-existing repo issue outside this patch: the existing `pnpm no-js` gate is tripping on tracked generated `.js` / `.d.ts` source artifacts under multiple workspace `src/` trees.

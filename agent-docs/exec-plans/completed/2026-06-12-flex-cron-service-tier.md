Goal (incl. success criteria):
- Run hosted `automation-cron` reminder turns on OpenAI flex processing (`service_tier=flex`, ~50% token cost) without ever delaying a reminder more than a bounded few minutes past its scheduled fire time.
- Success means: hosted cron turns send `serviceTier: "flex"` on the Codex `turn/start` RPC only on clean first runs (`consecutiveFailures === 0`); a flex turn is bounded by a deadline abort and falls back to the existing cron failure backoff (30s) whose retry runs standard tier; every non-flex `turn/start` explicitly clears the tier override (`serviceTier: null`) so user turns on a shared continuity thread never inherit flex; regression tests cover policy gating, envelope plumbing, and RPC param emission.

Constraints/Assumptions:
- Pinned `@openai/codex` 0.135.0 supports turn-level `serviceTier` (landed rust-v0.129.0; field verified present in the bundled binary; protocol structs are camelCase; double-option semantics: absent=inherit, null=reset-to-default).
- `service_tier` must NOT enter `CodexThreadIdentity`/route fingerprint (would fork continuity threads) or persisted session/provider target config; it is per-turn execution policy only.
- No process-spawn `--config` override (launch-affecting identity would churn the warm Codex App Server between cron and user turns).
- Hosted-only: gate on `executionContext.hosted`; dev ChatGPT-subscription auth lanes never request flex. Codex also silently drops tiers unsupported by the served model (`service_tier_for_request`).
- Reuse existing failure machinery: cron catch → `status='failed'` → `consecutiveFailures+1` → 30s backoff → wake via `nextWakeAt`; turn runner stays single-attempt; no new retry loops or persisted state.
- Avoid `compactWarmCodexThread` and `test/assistant-codex-scripted-runtime.test.ts` (owned by the active idle-compact usage attribution lane).

Key decisions:
- Fallback lives at the cron layer (flex only when `consecutiveFailures === 0`), not as a second attempt inside `executeCodexTurnWithRecovery`; the deadline abort is composed onto the automation envelope abort signal (`AbortSignal.any` + `AbortSignal.timeout(120s)`).
- `buildCodexTurnStartParams` always emits `serviceTier` (value or explicit `null`) so tier overrides never stick across turns.

State:
- Implementation is in review/verification in worktree `murph-flex-cron-tier` (branch `flex-cron-service-tier`).

Done:
- Read required repo docs; verified codex-rs semantics in pinned sibling checkout; verified prod model gpt-5.5 is flex-eligible; sized spend (~$97/mo cron run rate, ~50% savings) from `hosted_ai_usage`.
- Implemented service-tier plumbing from assistant message/service contracts through automation envelopes, notification turns, Codex runtime/provider execution, Codex CLI provider, and Codex App Server `turn/start` params.
- Added hosted cron policy: clean first hosted `automation-cron` turns use `serviceTier: "flex"` with a 120s composed deadline; retry/non-hosted turns use `serviceTier: null`.
- Added regression tests for hosted cron flex gating/retry behavior, notification-turn passthrough, and `turn/start` `serviceTier` value/null emission.
- Passed focused assistant-engine Vitest coverage: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-cron-runtime.test.ts test/assistant-notification-turn-runtime.test.ts test/assistant-codex-runtime.test.ts --no-coverage`.
- Coverage audit added focused tests for non-hosted cron `serviceTier: null`, upstream abort composition through the flex deadline wrapper, and `executeCodexTurnWithRecovery` forwarding `serviceTier` to provider attempts.
- Passed post-coverage verification: `pnpm --dir packages/assistant-engine typecheck`, `git diff --check`, focused 4-file assistant-engine Vitest run (184 tests), and full `pnpm --dir packages/assistant-engine test` (106 files, 1253 passed, 3 skipped).
- Passed `pnpm build:test-runtime:prepared`; initial wrapper typecheck failures were due missing generated package artifacts in the worktree.
- `bash scripts/workspace-verify.sh test:diff <assistant-engine changed paths>` passed affected package typechecks and full `packages/assistant-engine` tests, but later failed outside this diff in `packages/assistant-cli` startup-import timeout tests; earlier in the same verification lane `packages/assistant-cli` tests passed, and the failing file has no diff.
- Security/privacy review found no actionable issues.
- Deep review found that the final Codex RPC send path re-stripped `serviceTier: null`; fixed with `prepareCodexRpcParams` preserving explicit `turn/start.serviceTier: null` at the wire boundary and added a wire-level test assertion.
- Passed post-fix verification: `pnpm --dir packages/assistant-engine typecheck`, `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-codex-runtime.test.ts --no-coverage`, focused 4-file assistant-engine Vitest run (184 tests), full `pnpm --dir packages/assistant-engine test` (106 files, 1253 passed, 3 skipped), and `git diff --check`.
- Targeted deep-review rerun confirmed the RPC null-preservation fix and found no remaining sticky-tier reset issue.
- Final task-finish review found no code-level issues; stale plan status was the only finding and is resolved in this update.

Now:
- Ready to close the active plan with `scripts/finish-task` and commit the scoped diff.

Next:
- Post-deploy/live runtime confirmation that OpenAI actually honors or echoes the requested flex tier.

Open questions (UNCONFIRMED if needed):
- None blocking; empirical prod verification (response echoes actually-used `service_tier`) happens after deploy, outside this change.

Working set (files/ids/commands):
- `packages/assistant-engine/src/assistant/service-contracts.ts`
- `packages/assistant-engine/src/assistant/automation/turn-envelope.ts`
- `packages/assistant-engine/src/assistant/cron/execution.ts`
- `packages/assistant-engine/src/assistant/notification-turn.ts`
- `packages/assistant-engine/src/assistant/codex-turn-runner.ts`
- `packages/assistant-engine/src/assistant/providers/types.ts`
- `packages/assistant-engine/src/assistant/codex-runtime.ts`
- `packages/assistant-engine/src/assistant/providers/codex-cli.ts`
- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/src/assistant-codex/app-server-requests.ts`
- matching `packages/assistant-engine/test/*`
Status: completed
Updated: 2026-06-12
Completed: 2026-06-12

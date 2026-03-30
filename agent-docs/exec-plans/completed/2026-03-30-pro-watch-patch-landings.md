# 2026-03-30 Pro Watch Patch Landings

## Goal

- Watch two existing ChatGPT Pro threads, resume this Codex session when each attachment is ready, and land the returned patch intent safely on top of the live dirty worktree.

## Scope

- `agent-docs/exec-plans/active/2026-03-30-pro-watch-patch-landings.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `CONTINUITY_pro-watch-patch-landings.md`
- The smallest set of source, test, config, or doc files directly required by the downloaded patch attachments from:
  - `https://chatgpt.com/c/69c9f562-39bc-832a-9cf5-37e55a2ff46e`
  - `https://chatgpt.com/c/69c9f7d6-e264-8329-aa6f-be0b1a18a691`

## Findings

- The user asked for `work with pro`, provided two existing ChatGPT conversation URLs, and asked for delayed implementation after `40m` and `60m`, which makes this a `watch-only` flow.
- The repo already has `@cobuild/review-gpt` installed, `cobuild-review-gpt thread wake` available, and `CODEX_THREAD_ID` set in the current session.
- The worktree is already heavily dirty and the coordination ledger has many overlapping non-exclusive lanes, so any returned patch must be treated as intent and merged narrowly after reading live file state first.
- The current explicit watch request for `69c9f7d6-e264-8329-aa6f-be0b1a18a691` is now `70m`; do not post a new follow-up prompt into that thread.
- The `69c9f7d6-e264-8329-aa6f-be0b1a18a691` wake has now resumed with the attachment `murph-gateway-review-fixes.patch`.
- The returned patch targets the active gateway-core lane and maps to the current tree as edits in `apps/cloudflare/src/{execution-journal.ts,gateway-store.ts,user-runner.ts,user-runner/runner-commit-recovery.ts}`, `apps/cloudflare/test/{runner-queue-store.test.ts,user-runner.test.ts}`, `packages/cli/src/{gateway-core.ts,gateway/live-state.ts,gateway/opaque-ids.ts,gateway/projection.ts,gateway/snapshot.ts,gateway/send.ts}`, and `packages/cli/test/gateway-local-service.test.ts`.

## Constraints

- Do not post new prompts into the supplied ChatGPT threads unless the user later asks for that explicitly.
- Preserve unrelated in-flight edits and active ledger lanes.
- If a returned patch widens into broader design or multi-area refactoring, update this plan before continuing.
- For non-doc repo changes touching production code or tests, run the required completion audits in order: `simplify` then `task-finish-review`.

## Plan

1. Register the active delayed-patch lane in the coordination ledger and continuity note.
2. Schedule `thread wake` for the requested URLs against the current `CODEX_THREAD_ID`, using the latest explicit delays from the user.
3. When resumed, inspect exported thread artifacts and downloaded patch files before editing.
4. Land the smallest safe delta that satisfies each patch intent while preserving overlapping local edits.
5. Run focused verification for the touched gateway and hosted-runner files, then the required repo checks and mandatory audit passes because this patch touches production code and tests.
6. Close the plan and commit only the touched files for this lane.

## Verification

- Passed: `pnpm -s exec cobuild-review-gpt --help`
- Passed: `pnpm -s exec cobuild-review-gpt thread wake --help`
- Passed: `printenv CODEX_THREAD_ID`
- Passed: `pnpm exec tsc -p packages/cli/tsconfig.json --noEmit`
- Passed: `pnpm exec tsc -p apps/cloudflare/tsconfig.json --noEmit`
- Passed: `pnpm --dir packages/cli exec vitest run --config vitest.config.ts test/gateway-local-service.test.ts --no-coverage`
- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-queue-store.test.ts apps/cloudflare/test/user-runner.test.ts --no-coverage`
- Passed: `pnpm typecheck`
- Passed: `pnpm test`
- Passed: `pnpm test:coverage`
- Passed: mandatory `simplify` audit subagent; no actionable simplifications found.
- Skipped: mandatory `task-finish-review` audit because the user explicitly said `dw about final finish audit` in the completion turn.

## Outcome

- Completed: the gateway review-fixes patch landed on the live dirty tree with focused regressions plus full repo verification green.
Status: completed
Updated: 2026-03-31
Completed: 2026-03-31

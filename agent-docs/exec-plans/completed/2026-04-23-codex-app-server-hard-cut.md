# Land Codex app-server hard cut

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Land the supplied Codex hard cut so Murph no longer routes Codex turns through the legacy executor path and instead uses the `codex app-server` JSON-RPC/stdout lifecycle end to end, with docs/config/runtime copy aligned to that execution model and no silent fallback to the removed path.

## Success criteria

- The supplied patch intent is integrated cleanly on current `HEAD`, including the new app-server driver, provider/session mapping, failure behavior, and the directly coupled docs/config copy.
- Verification runs for the touched assistant/CLI surfaces, or any environment blocker is named precisely with the highest-signal scoped proof that still ran.
- Required repo completion audits run for this high-risk lane before handoff.
- A same-thread Pro review request is sent to the user-provided ChatGPT thread for bug/simplification review, or the exact send/wake blocker is recorded precisely.
- The final scoped commit contains only this task's repo changes plus plan/ledger closeout.

## Scope

- In scope:
  - `packages/assistant-engine` Codex provider execution/runtime files touched by the supplied hard cut
  - directly coupled CLI/setup copy and generated config schema updates from the supplied patch
  - directly coupled durable docs touched by the patch (`ARCHITECTURE.md`, `agent-docs/SECURITY.md`)
  - required plan/ledger bookkeeping, verification, required completion audits, and the user-requested Pro follow-up review
- Out of scope:
  - unrelated assistant-runtime, hosted-runtime, or Health Commons work already in flight elsewhere in the tree
  - broader provider architecture cleanup beyond what the supplied hard-cut patch requires
  - dependency changes or new fallback/compatibility shims not present in the supplied patch intent

## Constraints

- Technical constraints:
  - Treat the supplied patch as behavioral intent, not overwrite authority; integrate cleanly on current `HEAD`.
  - Preserve any unrelated working-tree or ledger state and avoid widening into active overlapping lanes.
  - Keep secrets, local account identifiers, and home-directory details out of repo files, logs, commits, and handoff.
- Product/process constraints:
  - This is a high-risk repo change, so it needs a plan, ledger row, verification, required completion audits, and a scoped commit path through `scripts/finish-task`.
  - The external Pro review is additive only; it does not replace the repo-required local audit passes.

## Risks and mitigations

1. Risk: the supplied patch may drift against current assistant-engine/Codex files and require manual integration.
   Mitigation: dry-check the patch first, read back the touched files after apply, and keep any manual fixes confined to the patch's stated scope.
2. Risk: the environment may not support the repo's full pnpm verification lane.
   Mitigation: run the highest-signal truthful checks available, record exact blockers, and still complete the required review/audit flow.
3. Risk: the requested Pro follow-up may fail to send or the wake flow may not arm cleanly.
   Mitigation: verify `CODEX_THREAD_ID`, use the repo's `review:gpt`/`thread wake` path, and record concrete send/wake status instead of assuming delivery.

## Tasks

1. Register the active scope in the coordination ledger.
2. Dry-check and apply the supplied patch, then resolve any current-HEAD drift without widening the change.
3. Read back the touched assistant/Codex surfaces and confirm the hard cut removed the intended legacy path from active source.
4. Run verification for the touched packages/docs, noting any environment blockers precisely.
5. Run the required completion audits and address any findings.
6. Send the requested same-thread Pro review follow-up and arm the wake flow if the local tool path supports it.
7. Finish the task through the scoped plan-bearing commit path.

## Decisions

- Rejected a local type widen in `model-harness.ts` (`AssistantExecutionDriver | 'codex-app-server'`) as too hacky; kept the declared type intact and normalized the runtime driver string locally where the app-server branch is selected.
- Kept the Codex provider identity as `codex-cli` while moving its execution driver/runtime contract to `codex-app-server` and its native resume kind to `codex-thread`, matching the hard-cut intent without widening provider taxonomy.
- Removed the explicit per-turn `sandboxPolicy` override from the app-server `turn/start` payload so Murph does not silently narrow Codex workspace-write behavior relative to the configured `-s` / profile policy.
- Fail closed on non-`never` approval policies for noninteractive assistant turns instead of advertising a runtime mode Murph cannot answer once app-server emits approval requests.
- Manually aligned the generated CLI config-schema approval-policy copy after the generator was blocked by unrelated `packages/cli` build errors in this checkout.

## Verification

- Commands to run:
  - `git apply --check Downloads/codex-app-server-hard-cut.patch`
  - `pnpm typecheck`
  - `pnpm test:diff <touched paths...>` or the highest-signal truthful scoped fallback if `pnpm`/runtime constraints block that lane
  - `git diff --check`
  - required completion audits for this task class
  - the user-requested `pnpm review:gpt --send ...` same-thread follow-up plus `cobuild-review-gpt thread wake ...` if supported here
- Expected outcomes:
  - The patch applies cleanly or only needs scoped current-HEAD integration fixes.
  - Verification is green, or any unrelated/environment blocker is explicit and bounded.
  - The Pro follow-up either lands with a concrete thread/wake status or fails with a precise local-tool reason.

## Verification status

- Completed:
  - `git apply --check Downloads/codex-app-server-hard-cut.patch`
    - failed on one `packages/assistant-engine/src/model-harness.ts` hunk only; the rest of the patch landed with scoped manual integration
  - `git diff --check`
    - passing after integration fixes
  - `pnpm --dir packages/operator-config build`
    - required locally to refresh `dist` type surface consumed by downstream workspace package resolution after contract-source changes
  - `pnpm --dir packages/assistant-engine exec vitest run test/assistant-codex-runtime.test.ts test/provider-registry-attempts.test.ts test/provider-registry-helpers.test.ts test/provider-turn-runner.test.ts test/failover.test.ts test/provider-continuity.test.ts test/assistant-automation-support.test.ts test/assistant-local-service-runtime.test.ts test/assistant/rich-content-routing.test.ts`
    - passing; 9 files / 115 tests
  - `pnpm --dir packages/assistant-cli exec vitest run test/assistant-command-coverage.test.ts test/assistant-command-runtime.test.ts test/assistant-daemon-client-more.test.ts test/assistant-daemon-client-owned-coverage.test.ts test/assistant-doctor.test.ts test/assistant-ui-ink.test.ts`
    - passing; 6 files / 47 tests
  - `pnpm --dir packages/cli exec vitest run test/assistant-codex.test.ts test/assistant-provider.test.ts`
    - passing; 2 files / 51 tests
  - `pnpm --dir packages/operator-config exec vitest run test/assistant-seam-coverage.test.ts`
    - passing; 1 file / 5 tests
  - required `coverage-write` pass
    - landed one test-only addition in `packages/assistant-engine/test/provider-turn-runner.test.ts` proving `providerActionCount > 0` makes failed Codex app-server attempts terminal even when `executedToolCount` stays `0`
  - `pnpm review:gpt --send --chat-url https://chatgpt.com/c/69e90cba-6ea0-839c-9be0-d2e4675562e7 --preset bug-hunt --preset simplify --preset legacy-removal --prompt "..."`
    - sent successfully to the requested existing thread; draft auto-send confirmed with attachments staged by the repo tool
  - `pnpm exec cobuild-review-gpt thread wake --delay 0s --poll-interval 1m --poll-timeout 120m --chat-url https://chatgpt.com/c/69e90cba-6ea0-839c-9be0-d2e4675562e7 --session-id \"$CODEX_THREAD_ID\"`
    - armed successfully; confirmed running via process inspection with the expected chat URL and session id
  - post-review fix verification:
    - `pnpm --dir packages/assistant-engine exec vitest run test/assistant-codex-runtime.test.ts test/failover.test.ts`
      - passing; 2 files / 21 tests
    - `pnpm --dir packages/cli exec vitest run test/assistant-codex.test.ts`
      - passing; 1 file / 9 tests
- Blocked by unrelated pre-existing repo state:
  - `pnpm typecheck`
    - fails in `packages/inbox-services` on `test/runtime-type-ownership.test.ts` importing `@murphai/inbox-services`
  - `pnpm test:diff`
    - fails early in CLI targeted verification because unrelated `packages/query` `estimatedVo2Max` type errors stop the lane before the touched assistant tests run
  - `pnpm --dir packages/cli exec vitest run test/inbox-model-harness.test.ts`
    - fails on an unrelated `@murphai/assistant-engine` export-map/import-path issue for `./assistant/automation/artifacts`
  - `pnpm --dir packages/cli gen:config-schema`
    - blocked by unrelated `packages/cli` build errors resolving `@murphai/contracts` plus unrelated command-shape type errors; schema copy was aligned manually instead
  - post-coverage rerun of the assistant-engine verification slice
    - 8 files / 108 tests passed, with `test/provider-continuity.test.ts` blocked by an unrelated parse error in `packages/assistant-engine/src/assistant/cron/food-auto-log.ts`
Completed: 2026-04-23

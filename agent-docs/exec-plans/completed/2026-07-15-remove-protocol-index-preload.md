# Remove unused assistant protocol index preload

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Delete the unused Health Commons protocol-index preload from assistant turn
  planning, including its timing/trace producer and private formatting API,
  while preserving task-time protocol discovery through `vault-cli commons`.

## Success criteria

- Assistant turn planning no longer reads or formats the generated protocol
  index before every provider turn.
- The assembled system prompt and task-time Health Commons discovery commands
  remain unchanged in behavior.
- The obsolete preload input type, timing stage, trace field, Health Commons
  helper API, assistant-engine dependency/reference/alias, and their tests are
  deleted rather than replaced by a shim.
- The Cloudflare runner still installs Health Commons for generated catalog
  assets, and its package-root/env wiring remains intact.
- The deferred hosted-execution and Web diagnostic consumers remain permissive
  until deployed producers and retained legacy log rows have drained.
- Dependency guards, focused tests, Health Commons verification, stale-symbol
  searches, diff checks, and the truthful diff-aware verification lane pass.

## Scope

- In scope: the assistant-engine planning/system-prompt/trace producer, the
  assistant-runtime provider-trace projection, the now-dead Health Commons
  assistant index adapter, their exact tests, assistant-engine dependency and
  build/test configuration, and the lockfile importer entry.
- Out of scope: `vault-cli commons` commands, the generated Health Commons
  protocol index, CLI/Cloudflare Health Commons dependencies, runner package-
  root/env wiring, historical changelogs and completed plans, and strict
  consumer-schema retirement in hosted-execution or Web.

## Constraints

- Prefer deletion only; add no feature flag, fallback, compatibility adapter,
  migration, or replacement preload.
- Preserve all task-time protocol discovery and exact CLI guidance in the
  resident prompt.
- Do not edit the four deferred consumer files in
  `packages/hosted-execution/{src/parsers/runtime-control.ts,test/hosted-runtime-control.test.ts}`
  or `apps/web/{src/lib/hosted-workspace/store.ts,test/hosted-workspace-store.test.ts}`.
- Work only in the isolated `agent/remove-protocol-index-preload` branch and
  preserve unrelated active lanes.

## Risks and mitigations

1. Risk: removing the assistant-engine dependency could accidentally remove the
   generated catalog from the hosted runner.
   Mitigation: Cloudflare and the CLI retain their direct Health Commons
   dependencies; keep the Docker/package-root/env and runner-bundle wiring
   unchanged and verify stale references only in the producer owners.
2. Risk: removing the consumer allowlists at the same time would reject
   diagnostics from old warm runners or retained historical log rows.
   Mitigation: remove only the same-bundle producer/projection now. Defer strict
   hosted-execution/Web schema cleanup until the new runner is fully deployed,
   the configured 20-minute warm-runner window has drained, seven days have
   elapsed after the last old `assistant.automation_detail` row, the next hourly
   retention cleanup has completed, and production inspection finds zero rows
   with the retired timing key or stage.
3. Risk: broad active ledger rows touch assistant planning/runtime tests.
   Mitigation: keep this isolated patch to the exact files registered below;
   rebase normally after overlapping PRs merge and rerun affected verification.

## Tasks

1. Remove the per-turn preload, prompt input, timing stage, and trace producer.
2. Remove the dead Health Commons adapter/type/helpers and assistant-engine
   dependency/build/test configuration.
3. Update and rename the affected planning/prompt/runtime tests while retaining
   direct proof for task-time CLI discovery.
4. Regenerate the lockfile intentionally and run the required dependency,
   focused owner, Health Commons, stale-reference, and diff-aware checks.
5. Hand the uncommitted implementation to the parent agent for coverage audit,
   commit/PR creation, CI, and exact-head ReviewGPT.

## Decisions

- Treat the preload as dead because the prompt builder does not read it and
  current behavior intentionally discovers protocols at task time.
- Remove assistant-runtime's trace projection in the same change because it is
  bundled with the producer and has no new value once the producer field is
  gone.
- Keep hosted-execution and Web acceptance temporarily because they parse
  independently deployed and persisted diagnostics.
- Keep current Health Commons product documentation because the compact
  generated protocol index remains a live CLI/runtime artifact.

## Verification

- `pnpm deps:guard`
- `pnpm deps:audit`
- `pnpm deps:ignored-builds`
- Focused Vitest runs for the touched assistant-engine, assistant-runtime, and
  Health Commons test files.
- `pnpm --dir packages/health-commons verify`
- Scoped stale-symbol searches proving producer/API removal while the four
  deferred consumer files remain unchanged.
- `git diff --check`
- `pnpm test:diff <all changed code/test/config paths>`

## Verification outcomes before publication

- The required coverage-write audit passed after adding only planner-level
  proof for the absent preload/timing stage and assistant-runtime proof that
  the retired field/stage are omitted from hosted trace projection.
- Focused verification passed assistant-engine 117/117, the renamed planning
  file 38/38, assistant-runtime events 32/32, Health Commons runtime 24/24,
  CLI Commons 8/8, and Cloudflare Health Commons pack/install/container
  contracts 28/28.
- Producer/API stale-symbol and whitespace checks passed. The four deferred
  hosted-execution/Web consumer files remain byte-unchanged and continue to
  accept retained legacy diagnostics during the drain window.
- The prior implementation worker did not finish the dependency and truthful
  diff-aware lanes before its session ended. The parent must run those checks
  on the final rebased head before publication.
Completed: 2026-07-15

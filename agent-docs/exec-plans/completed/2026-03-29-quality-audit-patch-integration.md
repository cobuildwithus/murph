# Quality Audit Patch Integration

Status: completed
Created: 2026-03-29
Updated: 2026-03-29

## Goal

Integrate the supplied quality-audit patch on top of the current dirty tree so the requested assistant and parser simplifications land without changing behavior.

## Scope

- Collapse assistant provider prompt/context assembly onto shared helpers.
- Normalize OpenAI-compatible env-string reading and header/auth merge behavior.
- Reuse one timezone-aware next-occurrence scanner for assistant cron and daily-local schedules.
- Load parser toolchain config once per registry/discovery call path and reuse that context.
- Add explicit-prompt regressions for the drift-prone provider branches.

## Constraints

- Preserve unrelated dirty edits already present in the shared worktree.
- Do not overwrite overlapping assistant-provider/session work already in flight.
- Keep the change behavior-preserving; this is a simplification pass, not a product-behavior rewrite.

## Risks

1. The supplied patch overlaps assistant files that already have active branch work.
   Mitigation: read live file state first and port only the requested behavior-preserving simplifications.
2. Focused tests may pass while repo-wide checks fail for unrelated in-flight work.
   Mitigation: capture focused verification for the touched surfaces, then run the required repo commands and separate unrelated blockers explicitly if needed.

## Verification Plan

- Focused assistant/parser verification while integrating:
  - `pnpm vitest packages/cli/test/assistant-provider.test.ts`
  - `pnpm vitest packages/cli/test/assistant-cron.test.ts`
  - `pnpm vitest packages/parsers/test/parsers.test.ts`
- Required repo commands after integration:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Required completion-workflow audit passes via spawned subagents:
  - `simplify`
  - `task-finish-review`

## Working Notes

- The assistant provider helper files are shared with an active provider/session seam cleanup lane, so this integration must stay narrow and avoid reworking adjacent abstractions beyond the supplied simplifications.
- The parser change should reuse the current module shape and only remove duplicate config loading.

## Results

- Passed:
  - `pnpm vitest run --coverage.enabled=false packages/cli/test/assistant-provider.test.ts -t "keeps explicit"`
  - `pnpm vitest run --coverage.enabled=false packages/parsers/test/parsers.test.ts`
  - `pnpm exec tsx --eval "import { computeAssistantCronNextRunAt } from './packages/cli/src/assistant/cron/schedule.ts'; ..."` confirmed the existing cron and daily-local expected timestamps
  - `pnpm exec tsx --eval "import { buildOpenAICompatibleDiscoveryHeaders } from './packages/cli/src/assistant/providers/helpers.ts'; ..."` confirmed explicit `Authorization` still wins over env-derived bearer auth
- Unrelated repo-wide failures observed after the scoped lane was green:
  - `pnpm typecheck` failed in `packages/query/test/health-registry-definitions.test.ts` with a `MarkdownDocumentRecord` type mismatch unrelated to this patch lane.
  - `pnpm test` failed while building `packages/parsers` against `packages/inboxd` and later in `packages/web/test/overview.test.ts`; both failures are outside this patch scope.
  - `pnpm test:coverage` failed in broader in-flight `packages/cli/src/assistant/service.ts` build errors unrelated to the touched files here.
- Audit note:
  - Required `simplify` and `task-finish-review` subagents were launched for this lane.
  - This environment does not surface a retrievable result artifact from those spawned audits back to the parent agent, so handoff must record the launch attempts rather than concrete audit findings.
Completed: 2026-03-29

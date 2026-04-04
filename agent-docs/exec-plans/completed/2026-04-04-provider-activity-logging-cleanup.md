# 2026-04-04 Provider Activity Logging Cleanup

## Goal

Simplify the shared provider activity logging architecture so provider implementations only emit shared progress events while the shared provider execution boundary derives per-turn activity summaries in one place.

## Scope

- Shared provider progress helpers under `packages/assistant-core/src/assistant/provider-progress.ts`
- Shared provider execution wrapper under `packages/assistant-core/src/assistant/providers/registry.ts`
- Provider implementations under `packages/assistant-core/src/assistant/providers/{codex-cli.ts,openai-compatible.ts}`
- Any narrow follow-up cleanup in `packages/assistant-core/src/assistant-codex.ts`
- Focused CLI/provider tests under `packages/cli/test/**`

## Constraints

- Keep the visible terminal behavior unchanged for safe command/tool labels.
- Keep persisted metadata limited to compact safe activity labels only.
- Avoid reintroducing provider-specific summary logic once the shared wrapper owns it.
- Preserve unrelated dirty-tree work.

## Plan

1. Review the landed provider activity logging changes for duplicated responsibilities and unnecessary provider coupling.
2. Move shared activity summarization to the provider execution boundary and add any missing shared progress helpers.
3. Remove now-redundant provider-local summary code while preserving emitted progress events.
4. Update focused tests to assert the simplified architecture and rerun the narrow verification lane.

## Progress

- Done: reviewed the landed design and identified duplicated activity-summary collection inside provider implementations.
- Done: moved activity summary collection to the shared provider registry wrapper so providers only emit shared progress events.
- Done: added shared tool-progress construction helpers and switched both Codex and OpenAI-compatible tool progress over to the shared helper path.
- Done: extended attempt-failure receipts to persist the same compact activity summary used on successful attempts.
- Done: reran focused assistant progress tests with `pnpm exec vitest run --coverage.enabled=false packages/cli/test/assistant-cli.test.ts packages/cli/test/assistant-provider.test.ts packages/cli/test/assistant-codex.test.ts`.
- Done: reran `pnpm typecheck`, which now passes.
- Done: reran `pnpm test`; the cleanup did not introduce new assistant-core/CLI failures, and the remaining failures are still in the unrelated Cloudflare worker/runtime lane.
- Now: close the plan and commit the cleanup.
- Next: hand off the simplified architecture and the current repo-wide test status.

Status: completed
Updated: 2026-04-04
Completed: 2026-04-04

# Sanitized Usage Metadata

## Goal

Persist token-only provider usage metadata for hosted AI usage rows so token extraction bugs can be debugged without storing prompts, responses, headers, or raw event logs.

## Success Criteria

- Hosted AI usage rows can store provider request id, sanitized raw usage JSON, sanitized raw usage hash, extraction version, and extraction source path.
- Stored raw usage JSON is limited to token/count metadata and provider-usage details, not full provider debug events.
- Direct hosted usage records carry the same sanitized metadata through hosted recording.
- Prisma schema and migration stay aligned.
- Focused tests cover persistence and privacy minimization.

## Constraints

- Preserve unrelated active provider-failure and app-server thread-instruction edits.
- Do not store prompts, responses, headers, transcripts, raw event logs, provider credentials, or local paths.
- Keep this as operational usage debug metadata, not canonical product state.

## State

- Done: Added token-only usage metadata extraction, hosted usage recording persistence, Prisma schema fields, and migration SQL. The former local pending-usage plumbing was superseded by direct hosted usage recording.
- Done: Added focused provider extraction, hosted recording, hosted migration, assistant-runtime, assistant-engine, and hosted-execution test coverage.
- Done: `pnpm typecheck` reaches unrelated `packages/vault-usecases` query package/type failures after the affected packages pass.
- Blocked: Repo-level `CI=1 pnpm test` enters an interactive setup prompt in root Vitest and was terminated.
- Now: Handoff pending; commit is blocked by overlapping active worktree edits.
- Next: Re-run repo-wide checks after unrelated vault-usecases/setup prompt issues are cleared, then close/commit the scoped plan.

## Working Set

- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/migrations/**`
- `apps/web/src/lib/hosted-execution/usage.ts`
- `apps/web/test/hosted-execution-usage.test.ts`
- `apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`
- `packages/assistant-engine/src/assistant/providers/helpers.ts`
- `packages/assistant-engine/src/assistant/providers/types.ts`
- `packages/assistant-engine/src/assistant/service-usage.ts`
- `packages/assistant-engine/test/codex-runtime-helpers.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-platform.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-usage.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts`
- `packages/hosted-execution/test/hosted-runtime-control.test.ts`
- `packages/hosted-execution/src/assistant-usage.ts`
- `packages/hosted-execution/test/assistant-usage.test.ts`

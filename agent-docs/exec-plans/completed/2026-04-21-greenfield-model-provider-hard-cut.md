# Greenfield Model Provider Hard Cut

## Goal (incl. success criteria):
- Remove the mirrored top-level `AssistantProviderConfig` fields so normalized provider state is owned by `target + policy` only.
- Hard-cut the remaining codebase and tests to the canonical normalized shape without reintroducing compatibility reads.
- Finish with repo-required verification green for the touched owner packages and reverse dependents.

## Constraints/Assumptions:
- Preserve unrelated worktree edits, including the pre-existing `apps/web/next-env.d.ts` modification.
- Keep `AssistantProviderConfigInput` as the flat compatibility/write-input surface where callers still need to supply unnormalized config.
- Do not expose personal identifiers in plan/commit/handoff text.

## Key decisions:
- Treat normalized `AssistantProviderConfig` as the canonical runtime/read shape and widen helper signatures to accept normalized configs directly.
- Keep provider identity derivation explicit through `resolveAssistantChatProviderFromConfig(...)` instead of mirrored top-level `provider`.
- Update downstream tests/mocks to assert or emulate `target + policy` rather than the removed mirrored fields.

## State:
- ready_to_close

## Done:
- Removed mirrored top-level fields from normalized `AssistantProviderConfig`.
- Updated operator-config and assistant-engine helpers to consume/read `target + policy`.
- Patched operator-config and downstream assistant-engine/assistant-runtime test fallout discovered by truthful verification.
- Fixed canonical preset normalization so stronger endpoint/provider identity overrides stale explicit preset ids.
- Fixed CLI model wizard/setup flows to clear stale saved provider presets when endpoint identity changes.
- Completed required `coverage-write` and `task-finish-review` audits, then reran the full scoped `test:diff` lane green.

## Now:
- Create the scoped completion commit and hand off the verification evidence.

## Next:
- None after commit/handoff.

## Open questions (UNCONFIRMED if needed):
- None currently.

## Working set (files/ids/commands):
- Files: `packages/operator-config/src/assistant/{provider-config.ts,target-runtime.ts}`, `packages/operator-config/src/{assistant-backend.ts,operator-config.ts}`, `packages/operator-config/test/{assistant-config-helpers.test.ts,assistant-seam-coverage.test.ts}`, `packages/assistant-engine/src/assistant/{provider-catalog.ts,provider-config.ts}`, `packages/assistant-engine/src/assistant/providers/registry.ts`, `packages/assistant-engine/test/assistant-local-service-runtime.test.ts`, `packages/assistant-runtime/test/hosted-assistant-bootstrap.test.ts`
- Verification: `pnpm typecheck`, `bash scripts/workspace-verify.sh test:diff ...`, focused Vitest reruns for assistant-engine and assistant-runtime fallout
- Audit: required `coverage-write` and `task-finish-review` subagent passes after verification stabilizes
Status: completed
Updated: 2026-04-21
Completed: 2026-04-21

# Native resume cutback

Status: completed
Created: 2026-04-13
Updated: 2026-04-13

## Goal

- Remove redundant transcript replay on assistant turns that already have native provider resume.
- Keep Murph's local transcript and session persistence as canonical local state while trusting provider-native continuity for active Responses/Codex resume.

## Success criteria

- Native-resume routes no longer send a transcript tail alongside `resumeProviderSessionId`.
- Bootstrap turns without native resume still replay local transcript history.
- Murph still persists full local transcripts and provider resume keys.
- Existing provider-turn and provider-execution behavior remains green.

## Scope

- In scope:
  - `packages/assistant-engine/**` route planning and provider tests for native resume behavior.
- Out of scope:
  - Changing local transcript persistence.
  - Changing provider resume-state storage.
  - Live provider probes.

## Constraints

- Preserve bootstrap replay for non-resumable turns.
- Preserve local transcript persistence for auditability, status, and provider-independent recovery.
- Keep unrelated active worktree edits untouched.

## Risks and mitigations

1. Risk: Removing transcript replay for resumed turns could accidentally drop bootstrap context on non-resumable routes.
   Mitigation: Keep replay logic explicitly gated on bootstrap requirement and cover both branches in tests.

2. Risk: Generic native-resume providers could depend on the current transcript tail behavior.
   Mitigation: Scope the change to the route-planning seam and update provider-turn tests to pin the intended native-resume contract.

## Tasks

1. Remove transcript-tail replay from native-resume route planning.
2. Update tests to assert empty/absent replay on resumed turns and preserved replay on bootstrap turns.
3. Run diff-aware verification and required audits.

## Decisions

- Murph local transcripts remain canonical local product/runtime state, but they should not be redundantly replayed on normal native-resume turns.
- The replay cutback is scoped to Responses-style `openai-response-id` resume. `codex-session` keeps the small replay tail so provider-side stale-session fallback still has local context.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:diff packages/assistant-engine`
- Expected outcomes:
  - Assistant-engine and reverse dependents stay green with the new native-resume contract.
- Actual outcomes:
  - `pnpm typecheck` passed.
  - `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/provider-turn-runner.test.ts` passed.
  - `pnpm --dir packages/cli exec vitest run --config vitest.config.ts test/assistant-runtime.test.ts` passed.
  - `pnpm test:diff packages/assistant-engine` is currently blocked by an unrelated `packages/query` export break from the active nutrition lane.
  - `pnpm --dir packages/assistant-engine test:coverage` is currently blocked by unrelated `assistant-vault-overview` / meal-mutation failures and existing file thresholds outside this diff.
Completed: 2026-04-13

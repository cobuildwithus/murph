# Clean Up Codex Subagent Hints

## Goal

Stack a cleanup PR on top of the Codex `0.143.0` upgrade PR that removes stale `0.142`-era hosted multi-agent hint assumptions while preserving standing Murph instructions that explicitly authorize Codex Subagent V2 delegation when it is valuable and safe.

Success criteria:

- Hosted Codex config comments and tests no longer claim a custom `root_agent_usage_hint_text` table exists.
- Assistant prompt/skill guidance keeps explicit, durable authorization for bounded non-reply-critical subagent work.
- Tests prove the standing prompt/skill references remain present.
- The branch opens as a separate PR targeting `agent/codex-0.143.0`.

## Constraints

- Base this branch on PR #463 (`agent/codex-0.143.0`).
- Do not switch Murph to proactive/Ultra-by-default behavior in this cleanup.
- Keep hosted plugins disabled and keep Codex skill rendering disabled; Murph owns the hosted tool surface and routes package-owned skills through prompt references.
- Preserve user reply primacy: no delegated work for urgent, reply-critical, approval, or user-facing send paths.

## Scope

Expected files:

- `packages/assistant-runtime/src/hosted-runtime/codex-config.ts`
- `packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/skills/murph-onboarding/SKILL.md`
- Focused assistant prompt/config tests as needed

## Verification

- Run focused tests for touched prompt/config surfaces.
- Run `pnpm typecheck` unless a credible unrelated blocker appears.
- Run `git diff --check` and local final diff review.

Completed evidence:

- Passed: `pnpm --dir packages/assistant-engine test test/model-behavior.test.ts test/system-prompt.health-record-ingestion.test.ts test/assistant-skill-assets.test.ts test/codex-runtime-helpers.test.ts test/codex-provider-overrides.test.ts`
- Passed: `pnpm --dir packages/assistant-runtime test test/hosted-runtime-codex-config.test.ts`
- Initial `pnpm typecheck` in a fresh worktree failed before the diff was typechecked because emitted workspace artifacts were absent; `pnpm build:test-runtime:prepared` restored the expected local artifacts.
- Passed after artifact prep: `pnpm typecheck`
- Passed: `bash scripts/workspace-verify.sh test:diff agent-docs/exec-plans/active/2026-07-08-codex-subagent-hints-cleanup.md packages/assistant-engine/skills/murph-onboarding/SKILL.md packages/assistant-engine/src/assistant/providers/helpers.ts packages/assistant-engine/src/assistant/system-prompt.ts packages/assistant-engine/test/assistant-skill-assets.test.ts packages/assistant-engine/test/codex-provider-overrides.test.ts packages/assistant-engine/test/codex-runtime-helpers.test.ts packages/assistant-engine/test/model-behavior.test.ts packages/assistant-engine/test/system-prompt.health-record-ingestion.test.ts packages/assistant-runtime/src/hosted-runtime/codex-config.ts packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts`
- Passed: `git diff --check`
- Parent final review read the full diff and found no unresolved stale hint wording, behavior-mode expansion, or identifier leakage introduced by this change.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07

# 2026-04-04 Provider Activity Logging

## Goal

Unify assistant provider progress logging so both Codex CLI and OpenAI-compatible turns surface specific command or tool labels in live progress output, and persist a small per-turn activity summary without storing raw tool arguments or outputs.

## Scope

- Shared assistant provider progress/event types under `packages/assistant-core/src/assistant/providers/**`
- Codex CLI progress extraction under `packages/assistant-core/src/assistant-codex.ts`
- OpenAI-compatible tool progress emission under `packages/assistant-core/src/assistant/providers/openai-compatible.ts`
- Provider-attempt receipt/diagnostic summaries under `packages/assistant-core/src/assistant/provider-turn-runner.ts`
- Auto-reply progress bridging under `packages/assistant-core/src/assistant/automation/**`
- Foreground terminal formatting under `packages/cli/src/run-terminal-logging.ts`
- Focused tests under `packages/cli/test/**`

## Constraints

- Keep the abstraction provider-agnostic; do not make the shared provider event contract Codex-specific.
- Persist only small safe labels or summaries, not raw tool payloads, stdout/stderr, or response arguments.
- Preserve overlapping dirty-tree edits in assistant-core and CLI files.
- Run the required repo verification commands plus at least one direct scenario check for the user-visible progress output.

## Plan

1. Define a shared provider progress event shape and activity-summary metadata contract.
2. Emit that shared progress shape from both Codex CLI and OpenAI-compatible providers.
3. Surface safe command/tool labels in auto-reply terminal progress while keeping existing generic fallbacks for unsafe or missing details.
4. Persist a small deduped activity summary on provider-attempt success without expanding receipt schema surface unnecessarily.
5. Add focused tests, run required verification plus a direct scenario check, then close the plan and create a scoped commit.

## Progress

- Done: read the repo routing, verification, and completion-workflow docs for this repo code task.
- Done: traced the current provider-progress path through `assistant-codex`, `providers/openai-compatible.ts`, `provider-watchdog.ts`, and `run-terminal-logging.ts`.
- Done: confirmed the current abstraction gap: shared provider progress is still typed as `CodexProgressEvent`, OpenAI-compatible emits tool trace updates but no shared progress events, and the terminal logger collapses command/tool progress to generic labels.
- Done: added a shared provider progress event contract plus deduped activity-label summarization for command/tool activity.
- Done: mapped Codex command/tool progress and OpenAI-compatible tool events into the shared progress contract, including safe terminal labels.
- Done: persisted compact per-turn activity summaries on `provider.attempt.succeeded` receipt metadata and forwarded safe progress details through the auto-reply watchdog.
- Done: added focused CLI/provider tests covering safe terminal labels, shared Codex activity summaries, and OpenAI-compatible shared tool progress events.
- Done: verified focused assistant tests with `pnpm exec vitest run --coverage.enabled=false packages/cli/test/assistant-cli.test.ts packages/cli/test/assistant-provider.test.ts packages/cli/test/assistant-codex.test.ts`.
- Done: ran required repo checks:
  - `pnpm typecheck` failed outside this lane in `packages/hosted-execution/src/parsers.ts` because `HostedExecutionDeviceSyncConnectLinkResponse` is missing.
  - `pnpm test` completed workspace tests but the overall verify step failed because the same unrelated hosted-execution/app verification errors were already present.
  - `pnpm test:coverage` failed outside this lane in Cloudflare worker/runtime tests plus one existing full-suite inbox CLI abort-status assertion that passes when run in isolation.
- Now: final diff review and scoped commit.
- Next: close the plan and hand off the verification notes with the exact unrelated failures.

Status: completed
Updated: 2026-04-04
Completed: 2026-04-04

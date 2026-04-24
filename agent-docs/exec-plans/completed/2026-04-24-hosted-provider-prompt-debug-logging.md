# Temporary hosted provider prompt debug logging

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Capture the exact hosted assistant-notification provider request shape that reaches the AI Gateway/Azure route so the launch blocker can be diagnosed from production logs.
- Include the full notification system prompt and user prompt in sanitized, chunked structured logs temporarily.
- Preserve existing hosted-run ledger ownership and do not change provider routing or delivery behavior.

## Success criteria

- Hosted assistant notification turns emit a provider request debug trace before the provider call.
- `packages/assistant-runtime` forwards that trace into hosted run logs with route/provider metadata plus chunked prompt text.
- Sanitization still redacts obvious secrets, local paths, phones, and email addresses before log entries are returned for web persistence.
- Focused tests cover trace emission and hosted runtime log forwarding.

## Scope

- In scope: `packages/assistant-engine/src/assistant/provider-turn-runner.ts`, `packages/assistant-runtime/src/hosted-runtime/events.ts`, directly coupled provider-turn and hosted-runtime event tests.
- Out of scope: provider selection changes, manual message sending, Linq delivery bypasses, schema changes, and persistent product state.

## Constraints

- This is intentionally temporary launch-debug observability. Keep the implementation easy to remove after Azure diagnosis.
- Do not log credentials, env values, headers, authorization details, or raw delivery provider payloads.
- Use existing hosted execution log sanitization for anything persisted back to the web-owned run log sink.

## Risks and mitigations

1. Risk: prompt logs may include sensitive health context.
   Mitigation: only emit for hosted notification-decision turns, rely on structured-log redaction, and keep the scope temporary and explicit.
2. Risk: oversized prompts may be truncated by structured log limits.
   Mitigation: chunk prompts into bounded arrays so the sanitizer preserves more text than one detail field.
3. Risk: overlapping hosted observability work.
   Mitigation: add only the trace forwarding path and preserve existing lifecycle/failure log behavior.

## Tasks

1. Add provider-turn request-debug trace emission for hosted notification-decision attempts.
2. Forward that trace through hosted runtime notification wake handling.
3. Chunk and sanitize prompt fields in hosted structured logs and redacted run-log entries.
4. Add focused tests for engine trace emission and runtime log forwarding.
5. Run focused verification plus required completion audits before deploy.

## Decisions

- Use `AssistantProviderTraceEvent.rawEvent` with a Murph-specific schema to avoid adding a new cross-package dependency from assistant-engine to hosted-execution.
- Do not gate this behind an env var for the launch-debug deploy; removal will be a follow-up once Azure behavior is understood.

## Verification

- Commands to run: focused provider-turn runner test, focused hosted-runtime events test, scoped package typechecks or `pnpm typecheck`, `git diff --check`, and required completion audit passes.
Completed: 2026-04-24

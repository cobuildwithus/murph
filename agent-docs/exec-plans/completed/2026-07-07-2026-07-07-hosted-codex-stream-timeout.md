# Hosted Codex stream timeout and observability

Status: completed
Created: 2026-07-07
Updated: 2026-07-07

## Goal

- Reduce the hosted Codex provider stream idle stall window that caused a
  foreground reply to wait about five minutes, while surfacing metadata-only
  transport retry/timeout evidence for future hosted runtime triage.

## Success criteria

- Hosted Codex config writes a shorter Codex-native `stream_idle_timeout_ms`
  for production hosted OpenAI/Codex provider turns without disabling
  WebSockets or adding a Murph-side scheduler/supervisor.
- Runtime diagnostics/logging expose the configured timeout and Codex stream
  retry/error/fallback events in a redacted, metadata-only way.
- Focused tests prove the generated config and observability behavior.
- Required verification passes, the scoped commit, PR creation, and PR-lane
  deep-review loop complete.

## Scope

- In scope:
  - `packages/assistant-runtime` hosted runtime phase diagnostics.
  - `packages/assistant-runtime` hosted Codex config generation and tests.
  - Narrow `packages/assistant-engine` Codex event diagnostics if needed to
    expose stream retry/fallback events already emitted by Codex.
- Out of scope:
  - Replacing Codex transport retry/fallback logic.
  - Adding a Murph-side active-turn watchdog, new queue, or scheduler.
  - Changing Cloudflare provider egress credential authority.

## Constraints

- Technical constraints:
  - Prefer Codex-native provider config over bespoke Murph supervision.
  - Keep observability fire-and-forget/metadata-only; do not log prompts,
    transcripts, provider payloads, secrets, raw paths, or personal identifiers.
  - Preserve hosted foreground reply priority and Codex App Server warm reuse.
- Product/process constraints:
  - Use the isolated worktree/PR lane.
  - Close the active plan with `scripts/finish-task` after verification.
  - Run the PR deep-review loop to zero accepted findings after opening the PR.

## Risks and mitigations

1. Risk: A shorter timeout increases retries for genuinely slow but healthy
   streams.
   Mitigation: Keep the first change to Codex's stream-idle knob, not a hard
   total-turn cap, and choose a conservative foreground value rather than a
   very aggressive one.
2. Risk: Observability leaks sensitive user/provider data.
   Mitigation: Log only event type, timing, retry/fallback status, and bounded
   error categories/messages through existing redaction paths.

## Tasks

1. Inspect hosted Codex config generation, assistant-engine Codex event
   handling, and focused test surfaces.
2. Add the configured hosted stream idle timeout and prove it in config tests.
3. Surface Codex stream retry/fallback/error events with metadata-only logs or
   diagnostics; add focused tests.
4. Run targeted verification, typecheck/test:diff as required, and local final
   diff review.
5. Commit through `scripts/finish-task`, push, open a PR, and run the PR
   deep-review loop.

## Decisions

- Use Codex-native `stream_idle_timeout_ms` rather than a Murph-side live-turn
  timeout as the first fix. This preserves the existing Codex transport owner
  and targets the observed 300s idle boundary directly.
- Keep WebSockets enabled. Existing Codex behavior retries stream errors and
  falls back to HTTPS transport after the retry budget, so this change shortens
  the silent-stream detection window and adds metadata-only evidence around
  retries/fallbacks.

## Verification

- Commands to run:
  - Focused tests for touched config/runtime/diagnostic surfaces.
  - `pnpm typecheck`
  - `pnpm test:diff <touched paths>`
  - PR-lane deep-review loop after PR creation.
- Completed before commit:
  - `pnpm exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-entrypoint.test.ts test/hosted-runtime-codex-config.test.ts test/hosted-runtime-events.test.ts`
  - `pnpm exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-runtime.test.ts`
  - `pnpm typecheck`
  - `pnpm test:diff packages/assistant-engine/src/assistant-codex.ts packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/codex-config.ts packages/assistant-runtime/src/hosted-runtime/events/provider-trace-log.ts packages/assistant-engine/test/assistant-codex-runtime.test.ts packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts packages/assistant-runtime/test/hosted-runtime-events.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- Expected outcomes:
  - Generated hosted Codex config contains the shorter stream idle timeout for
    hosted OpenAI production config and keeps WebSockets enabled.
  - Stream retry/fallback/timeout observability is metadata-only.
  - Hosted runtime phase logs expose configured Codex transport metadata.
  - All required checks pass or any unrelated blocker is documented with proof.
Completed: 2026-07-07

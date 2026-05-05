# Hosted Linq typing stop effect

Status: completed
Created: 2026-05-05
Updated: 2026-05-05

## Goal

- Make hosted Linq typing indicators use the same lifecycle contract as local Linq typing: start typing before assistant delivery and send the provider stop-typing call before the reply send.

## Success criteria

- `pnpm hosted-local e2e linq-delivery` no longer fails waiting for `DELETE /chats/:id/typing`.
- Hosted Linq typing effects remain routed through the existing provider-effects port; no parallel cleanup path or test-only special case.
- Focused unit tests cover hosted Linq typing start and stop behavior.

## Scope

- In scope:
  - `packages/assistant-runtime` hosted Linq chat-action contract and channel typing dependencies.
  - `apps/cloudflare` provider-effect parser/runtime tests for Linq typing stop.
- Out of scope:
  - Reworking provider-effect transport.
  - Changing Telegram typing semantics.
  - Live Linq or live OpenAI calls.

## Constraints

- Technical constraints:
  - Keep the effect model composable by extending the existing typed chat-action effect.
  - Do not expose raw provider keys or local paths in code, logs, docs, or handoff.
  - Preserve unrelated dirty work in overlapping hosted OpenAI/provider files.
- Product/process constraints:
  - External provider-effect/trust-boundary change, so run focused tests and direct Linq E2E proof.
  - Commit through `scripts/finish-task` only if scoped staging is safe.

## Risks and mitigations

1. Risk: Adding a one-off stop path creates duplicate provider-effect surfaces.
   Mitigation: Extend the existing Linq chat-action effect union and keep the same route.
2. Risk: Hosted stop effect could hide provider errors or leak secrets.
   Mitigation: Reuse existing provider-effect fetch/redaction path and add focused assertions only on sanitized behavior.

## Tasks

1. Patch the hosted Linq chat-action contract to support `typing_stop`.
2. Return a stoppable Linq typing handle from hosted channel typing dependencies.
3. Update focused unit tests for hosted Linq typing start and stop.
4. Run targeted package/app tests and rerun `pnpm hosted-local e2e linq-delivery`.
5. Audit diff and close/commit if scoped staging is safe.

## Decisions

- Prefer one typed Linq chat-action effect with `action: "typing" | "typing_stop"` over adding a new route or a test-only cleanup hook.

## Verification

- Commands run:
  - `pnpm exec vitest run packages/assistant-runtime/test/hosted-runtime-channel-activity.test.ts packages/assistant-runtime/test/hosted-provider-effects.test.ts --no-coverage`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/runner-outbound.test.ts --no-coverage`
  - `pnpm hosted-local e2e linq-delivery`
  - `pnpm typecheck`
- Outcomes:
  - Assistant-runtime focused tests passed: 8 tests.
  - Cloudflare runner focused tests passed: 109 tests.
  - Linq hosted-local delivery E2E passed: 6 tests.
  - Workspace typecheck passed.

## Handoff

- Committed with hunk-scoped staging because the same hosted-runtime and runner files already contain unrelated dirty work.
- The hosted OpenAI E2E assertion cleanup remains with the overlapping hosted OpenAI provider worktree changes, not this standalone Linq typing-stop commit.

Completed: 2026-05-05

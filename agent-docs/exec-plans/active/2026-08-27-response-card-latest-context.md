# Response Card Latest-Context Attachment

Status: active
Created: 2026-08-27
Updated: 2026-08-27

## Goal

Allow one response card to attach to the current accepted-input context after
live steering, while continuing to reject an attachment whose asynchronous tool
request belongs to an older context.

## Product UX Patch

- A private-direct member who sends another message before Murph finishes can
  still receive the requested card when the card completely answers the latest
  consolidated request.
- A card selected before newer accepted work remains invalidated unless Murph
  attaches a fresh card for the latest context.
- Existing audience, one-card, media, no-reply, approval, canonical-read, and
  delivery restrictions remain unchanged.
- The journey adds no new step, state owner, queue, provider call, or recovery
  path.

## Tasks

1. [complete] Replace the blanket ordinal-zero restriction with the existing
   current-context equality check.
2. [complete] Update focused live-steering coverage and the durable response-
   card contract.
3. [complete] Add one focused production-derived real-Codex journey and review
   its actual synthetic reply.
4. Add the member-facing changelog item, run focused checks and typecheck, then
   complete the required PR reviews and CI.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run --config
  vitest.config.ts --no-coverage test/assistant-codex-runtime-steering.test.ts
  -t "lets the latest steered context replace an earlier response card|renders
  oversized card recovery for the latest steered context"` — passed (2 tests).
- `pnpm --dir packages/assistant-engine typecheck` — passed.
- `pnpm test:assistant:live -- --test "attaches a fresh nutrition card for the
  latest live-steered request"` — passed with one card attached at delivery
  context ordinal 1 and the complete deterministic nutrition-card reply.

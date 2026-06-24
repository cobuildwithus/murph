# Hosted Telegram Auto-Reply No Native Anchor

Status: completed
Created: 2026-06-22
Updated: 2026-06-22

## Goal

- Improve Telegram auto-reply UX by preventing Murph's implicit auto-replies from rendering as native replies to the user's latest Telegram message.
- Preserve Telegram chat/thread delivery targeting and keep explicit low-level `replyToMessageId` support available for direct/manual sends.

## Success criteria

- Telegram auto-reply decisions and active-turn input admissions use `deliveryReplyToMessageId: null` for Telegram while still preserving provider delivery targets.
- Linq/email/WhatsApp reply-target behavior is unchanged.
- The Telegram channel adapter/runtime still passes through explicit `replyToMessageId` when a caller supplies one directly.
- Focused assistant-engine tests and scoped diff verification pass, or any unrelated failure is clearly identified.

## Scope

- In scope:
  - `packages/assistant-engine/src/assistant/automation/reply.ts`
  - Assistant delivery context/current-audience plumbing needed to separate reaction targeting from native reply anchoring.
  - Focused assistant-engine tests for Telegram auto-reply reply-anchor metadata.
  - Hosted-local Telegram test helper expectation if it keys outbound matching on `reply_to_message_id`.
- Out of scope:
  - New user/config-facing `replyToMode` surface.
  - Telegram adapter/runtime removal of explicit `replyToMessageId`.
  - iMessage/Linq reply behavior changes.

## Constraints

- Technical constraints:
  - Keep routing target and native reply anchor as separate concepts.
  - Avoid new abstractions unless the changed call sites need one to stay obvious.
- Product/process constraints:
  - Preserve user privacy in committed artifacts.
  - Keep the change narrow despite overlapping active assistant-engine lanes.

## Risks and mitigations

1. Risk: Dropping `replyToMessageId` accidentally drops Telegram thread targeting.
   Mitigation: Change only the delivery reply-anchor field; assert target preservation in tests.
2. Risk: Explicit direct Telegram sends lose reply support.
   Mitigation: Leave channel descriptor/runtime behavior unchanged and rely on existing adapter tests.

## Tasks

1. Add a small channel-aware normalization helper around auto-reply delivery reply anchors.
2. Apply it to initial auto-reply, active-turn late input, and captureless admission refresh paths.
3. Update focused tests and hosted-local Telegram matcher expectations.
4. Run targeted verification and required completion checks.

## Decisions

- Do not add OpenClaw/Hermes-style `replyToMode` config yet; Murph only needs Telegram auto-reply implicit native anchors disabled by default.
- Do not change the Telegram adapter/runtime explicit `replyToMessageId` surface.
- Split auto-reply reaction targeting from native text reply anchoring with `deliveryReactionTargetMessageId`, so Telegram can still use `react_to_message` while final/progress text sends omit `reply_to_message_id`.

## Verification

- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/assistant-automation-runtime.test.ts test/assistant-delivery-service.test.ts test/assistant-codex-final-coverage.test.ts test/assistant-protocol-index-planning.test.ts`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/assistant-service-runtime.test.ts test/assistant-delivery-service.test.ts`
- `pnpm hosted-local e2e telegram` with a throwaway local database
- `bash scripts/workspace-verify.sh test:diff ...` for the changed assistant-engine and hosted-local Telegram files
- `pnpm typecheck`
- `git diff --check`
Completed: 2026-06-22

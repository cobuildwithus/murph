# Minimize Telegram raw persistence while preserving auto-reply context

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Minimize persisted Telegram raw payloads for inbox captures while preserving attachment handling, reply routing, and the useful auto-reply prompt context users rely on for short reply messages.

## Success criteria

- Telegram webhook captures persist only a narrow schema plus a sanitized reply-context preview instead of provider-shaped raw payloads.
- Telegram auto-reply metadata continues to load message id and media-group id from minimized raw and still supplies reply context for terse reply scenarios.
- Telegram attachment handling and normalized capture text remain unchanged.
- Focused Telegram messaging-ingress, inboxd, and assistant-engine tests pass, along with repo-required typecheck and smoke coverage for this slice.

## Scope

- In scope:
- `packages/messaging-ingress/src/telegram-webhook-payload.ts`
- `packages/inboxd/src/connectors/telegram/normalize.ts`
- `packages/assistant-engine/src/assistant/automation/prompt-builder.ts`
- `packages/gateway-local/src/store/source-sync.ts`
- Directly coupled Telegram raw / auto-reply tests in `packages/messaging-ingress/test`, `packages/inboxd/test`, and `packages/assistant-engine/test`
- Directly coupled gateway-local provider-id compatibility coverage in `packages/gateway-local/test`
- Out of scope:
- Linq/raw minimization
- Gateway-local projection retention changes beyond Telegram provider-id compatibility
- Canonical inbox `raw` removal or SQLite `raw_json` removal
- Non-Telegram assistant transcript/outbox retention work

## Constraints

- Technical constraints:
- Keep attachment hydration on the live Telegram message path; do not introduce raw-dependent attachment behavior.
- Preserve hosted Telegram minimal raw compatibility and evolve it in-place rather than adding parallel Telegram raw formats.
- Avoid widening persisted provider metadata beyond a bounded, explicitly derived reply-context preview.
- Product/process constraints:
- Preserve average Telegram auto-reply UX, especially short replies where context is needed to interpret the current message.
- Respect existing dirty-tree work and avoid overlapping unrelated hosted Telegram/runtime rows.

## Risks and mitigations

1. Risk: Removing rich Telegram raw could cause assistant auto-replies to lose important context for terse replies.
   Mitigation: Persist a sanitized `reply_context_preview` derived during normalization and update assistant metadata loading to use it directly.
2. Risk: A hidden consumer could still rely on provider-shaped Telegram raw.
   Mitigation: Keep the raw schema change narrow, audit known consumers, and add focused tests for routing, metadata loading, and attachment-related normalization.
3. Risk: Downstream projections could lose Telegram provider ids if they only read the legacy nested raw shape.
   Mitigation: Add a flat-schema compatibility branch where downstream sync still resolves `message_id` from minimized raw.
4. Risk: Over-retaining preview content would reduce the privacy benefit.
   Mitigation: Bound the preview to summarized text and genericized shared-contact/location/venue descriptions without direct identifiers or exact coordinates.

## Tasks

1. Narrow Telegram raw minimization to a schema-owned metadata record with reply-context preview.
2. Thread the minimized schema through Telegram normalize paths without changing normalized capture text or attachment handling.
3. Update assistant auto-reply metadata loading to consume the minimized schema directly.
4. Keep downstream gateway-local Telegram provider-id extraction compatible with the minimized flat raw schema.
5. Refresh focused tests to lock the privacy boundary and UX-preserving preview behavior.
6. Run required verification and audit passes for the scoped Telegram slice.

## Decisions

- Use minimized Telegram raw as the source of auto-reply metadata, but store only explicit fields (`schema`, `message_id`, optional `media_group_id`, optional `reply_context_preview`) instead of provider-shaped message bodies.
- Keep reply-context preview separate from normalized `capture.text`; it is contextual metadata, not the inbound message body.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/messaging-ingress/src/telegram-webhook-payload.ts packages/messaging-ingress/test/telegram-webhook.test.ts packages/inboxd/src/connectors/telegram/normalize.ts packages/inboxd/test/telegram-connector.test.ts packages/assistant-engine/src/assistant/automation/prompt-builder.ts packages/assistant-engine/test/assistant-automation-prompt-builder.test.ts`
- `pnpm --dir packages/gateway-local exec vitest run test/source-sync.test.ts`
- `pnpm test:smoke`
- Expected outcomes:
- Typecheck passes for the touched Telegram paths.
- Diff-aware verification covers the touched owners and reverse dependents without Telegram regressions.
- Smoke verification stays green.

## Outcome

- Implemented a minimized Telegram raw schema with `schema`, `message_id`, optional `media_group_id`, and optional bounded `reply_context_preview`.
- Preserved normalized `capture.text` and attachment hydration while removing provider-shaped Telegram payload persistence from new captures.
- Updated assistant auto-reply metadata loading to use the minimized preview directly while retaining legacy rich-raw fallback for older envelopes.
- Added the narrow gateway-local Telegram `message_id` compatibility branch needed for flat minimized raw, with fail-closed numeric validation.
- Focused Telegram and gateway-local verification passed:
  - `pnpm --dir packages/messaging-ingress exec vitest run test/telegram-webhook.test.ts`
  - `pnpm --dir packages/inboxd exec vitest run test/telegram-connector.test.ts`
  - `pnpm --dir packages/assistant-engine exec vitest run test/assistant-automation-prompt-builder.test.ts test/assistant-automation-support.test.ts`
  - `pnpm --dir packages/gateway-local exec vitest run test/source-sync.test.ts`
  - `pnpm --dir packages/{messaging-ingress,inboxd,assistant-engine,gateway-local} typecheck`
  - `pnpm test:smoke`
- Repo `pnpm typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff ...` remains red for a credibly unrelated pre-existing failure in `packages/assistant-engine/test/assistant-wrapper-exports.test.ts`, which still expects `executeCodexPrompt` to be exported.
- Direct scenario proof passed: a minimized Telegram raw envelope with a poll-plus-quote reply preview still loads the expected `messageId` and `replyContext` for assistant auto-reply metadata.
Completed: 2026-04-23

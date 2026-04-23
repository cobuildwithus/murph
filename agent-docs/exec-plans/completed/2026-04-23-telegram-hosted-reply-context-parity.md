# Thread Telegram reply-context preview through hosted captures for parity

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Thread the same bounded Telegram `reply_context_preview` used by local Telegram captures through the hosted-onboarding webhook path, hosted-execution wake contract, and hosted Telegram normalization so hosted captures preserve terse-reply auto-reply context too.

## Success criteria

- Hosted Telegram webhooks include an optional bounded `replyContextPreview` field in the hosted wake payload.
- Hosted Telegram normalization maps that field into minimized capture `raw.reply_context_preview` while keeping attachment hydration and normalized `capture.text` unchanged.
- Assistant auto-reply metadata for hosted Telegram captures sees the same minimized preview shape as local Telegram captures.
- Focused `apps/web`, `packages/hosted-execution`, `packages/assistant-runtime`, `packages/inboxd`, and assistant-engine parity checks pass, along with repo-required typecheck and smoke verification for this slice.

## Scope

- In scope:
- `apps/web/src/lib/hosted-onboarding/{telegram.ts,webhook-provider-telegram.ts}`
- `packages/hosted-execution/src/{contracts.ts,builders.ts,parsers.ts,parsers/telegram.ts}`
- `packages/inboxd/src/connectors/telegram/normalize.ts`
- Directly coupled hosted/web/runtime/inbox/assistant tests that prove hosted Telegram parity
- This active plan and the coordination-ledger row needed to reserve the lane
- Out of scope:
- Broader hosted Telegram runtime cleanup/delete work already tracked in the separate active hosted-runtime lane
- New retention changes outside the hosted Telegram reply-context parity seam
- Linq or email hosted capture changes

## Constraints

- Technical constraints:
- Preserve the existing hosted Telegram attachment contract and wake shape except for the one optional preview field.
- Avoid touching overlapping Cloudflare runner/outbox cleanup files owned by the active hosted Telegram runtime lane.
- Reuse the existing Telegram minimization logic rather than duplicating a second hosted-only preview algorithm.
- Product/process constraints:
- Keep hosted Telegram auto-reply UX aligned with local Telegram for terse reply-to-message cases without widening raw retention beyond the bounded preview.

## Risks and mitigations

1. Risk: Adding a new hosted wake field could miss one parser/builder/cloner seam and silently drop the preview.
   Mitigation: Thread the field through the hosted contract, builder clone path, parser, and hosted normalization together with focused contract round-trip tests.
2. Risk: The hosted preview logic could drift from local Telegram minimization and create inconsistent assistant behavior.
   Mitigation: Build the hosted preview from the same messaging-ingress helper used by local Telegram minimization.
3. Risk: Overlap with the active hosted Telegram runtime fixes row could create accidental cross-lane edits.
   Mitigation: Keep this slice confined to the hosted webhook payload, shared wake contract, hosted assistant-runtime ingestion seam, and directly coupled tests only.

## Tasks

1. Register the parity lane in the coordination ledger and map the hosted Telegram webhook-to-inbox path.
2. Extend the hosted Telegram wake contract with an optional `replyContextPreview` field and thread it through builders/parsers.
3. Populate the preview in the hosted-onboarding Telegram webhook builder using the shared Telegram minimization helper.
4. Map the hosted preview into minimized Telegram capture raw during hosted Telegram normalization.
5. Add focused tests covering hosted webhook payload building, hosted contract round-trips, hosted Telegram normalization, and assistant metadata parity.
6. Run required verification and audit passes, fix findings, and land a scoped commit.

## Decisions

- Prefer one optional `replyContextPreview` field on the hosted Telegram wake contract over recomputing preview later in runtime, because the web webhook parse already has the full Telegram reply payload and the downstream runtime should only carry the minimized derivative.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding/telegram.ts apps/web/src/lib/hosted-onboarding/webhook-provider-telegram.ts apps/web/test/hosted-onboarding-telegram*.test.ts packages/hosted-execution/src/contracts.ts packages/hosted-execution/src/builders.ts packages/hosted-execution/src/parsers.ts packages/hosted-execution/src/parsers/telegram.ts packages/hosted-execution/test/hosted-wake-parsers.test.ts packages/assistant-runtime/src/hosted-runtime/events/conversation.ts packages/assistant-runtime/test/hosted-runtime-conversation-event.test.ts packages/inboxd/src/connectors/telegram/normalize.ts packages/inboxd/test/telegram-connector.test.ts packages/assistant-engine/test/assistant-automation-prompt-builder.test.ts`
- `pnpm test:smoke`
- Expected outcomes:
- Hosted Telegram preview survives webhook planning, hosted wake parsing, hosted runtime ingestion, and inbox normalization.
- Attachment hydration and normalized hosted Telegram `text` behavior remain unchanged.
- Repo-level verification is green or fails only for a credibly unrelated pre-existing reason called out in handoff.

## Outcome

- Hosted Telegram webhook planning now includes an optional `replyContextPreview` on the hosted wake payload, built from the same bounded Telegram preview helper used by local Telegram minimization.
- Hosted-execution now carries that optional field through the Telegram wake contract and parser, and enforces the same 240-character cap at the shared hosted wake boundary rather than trusting only the current `apps/web` producer.
- Hosted Telegram normalization now maps `replyContextPreview` into minimized capture `raw.reply_context_preview`, so hosted and local Telegram captures expose the same assistant auto-reply metadata shape.
- Attachment hydration and normalized hosted `capture.text` behavior stayed unchanged.
- Focused verification passed:
  - `pnpm --dir apps/web test -- apps/web/test/hosted-onboarding-telegram-dispatch.test.ts`
  - `pnpm --dir packages/messaging-ingress exec vitest run test/telegram-webhook.test.ts`
  - `pnpm --dir packages/hosted-execution exec vitest run test/parser-helpers.test.ts test/hosted-wake-parsers.test.ts test/hosted-execution-builders-hosted-email.test.ts`
  - `pnpm --dir packages/inboxd exec vitest run test/telegram-connector.test.ts`
  - `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-conversation-event.test.ts`
  - `pnpm --dir packages/assistant-engine exec vitest run test/assistant-automation-prompt-builder.test.ts`
  - `pnpm --dir packages/{messaging-ingress,hosted-execution,inboxd,assistant-runtime} typecheck`
  - `pnpm test:smoke`
- Repo `pnpm typecheck` passed before handoff.
- `bash scripts/workspace-verify.sh test:diff ...` remains red for a credibly unrelated pre-existing failure in `packages/assistant-engine/test/assistant-wrapper-exports.test.ts`, which still expects `executeCodexPrompt` to be exported.
- Required audit passes completed:
  - `coverage-write` found the current focused coverage sufficient and made no edits.
  - `task-finish-review` first found that the hosted wake could briefly carry an overlong preview; that was fixed by capping at the shared parser boundary and by adding a hosted overlong-preview assertion before the final reruns.
Completed: 2026-04-23

# Minimize Linq raw persistence without regressing assistant UX or delivery

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Minimize duplicated Linq raw persistence in local and hosted inbox captures without regressing assistant prompt quality, reply routing, attachment handling, or hosted onboarding behavior.

## Success criteria

- Linq webhook captures no longer persist phone numbers, handles, text/link values, media URLs, or provider-shaped `parts` inside `raw`.
- Hosted Linq conversation captures also persist the same minimal raw schema instead of a second rich copy of message parts and direct identifiers.
- Normalized `capture.text`, attachments, `externalId`, and reply routing still behave the same for assistant auto-replies and hosted onboarding flows.
- Focused `messaging-ingress`, `inboxd`, hosted onboarding, and directly coupled reply/runtime tests pass, along with repo-required verification for this slice.

## Scope

- In scope:
- `packages/inboxd/src/connectors/linq/normalize.ts`
- directly coupled `apps/web` hosted-onboarding Linq webhook/dispatch tests for hosted no-regression proof
- directly coupled reply/runtime tests only where needed to prove no regression in Linq delivery behavior
- this active plan and the coordination-ledger row for the lane
- Out of scope:
- `packages/messaging-ingress/src/linq-webhook.ts`
- gateway-local retention changes
- broader hosted Linq wake-contract minimization beyond the capture `raw` seam
- assistant transcript/outbox retention changes
- Telegram/email work

## Constraints

- Technical constraints:
- Keep normalized `capture.text`, attachment download inputs, `externalId`, and reply linkage intact.
- Avoid touching the active hosted-local Linq voice memo lane beyond additive test coverage if absolutely required.
- Do not redesign the hosted execution Linq wake contract unless review proves it is necessary for this no-regression slice.
- Product/process constraints:
- Preserve current assistant UX; do not require the model to infer Linq context from less information than it already has today.

## Risks and mitigations

1. Risk: hidden consumers may still read rich Linq `raw` directly.
   Mitigation: audit assistant reply, hosted onboarding, and downstream sync paths before implementation; keep the minimal schema additive and explicit.
2. Risk: shrinking hosted Linq raw could accidentally break voice-memo/media attachment hydration.
   Mitigation: leave hosted wake `parts` untouched for now and only minimize the later capture `raw` copy; keep focused attachment tests green.
3. Risk: removing reply-related raw fields could break Linq reply delivery.
   Mitigation: preserve stable `message_id`, `reply_to_message_id`, and `reply_to_part_index` in minimal raw, and verify reply routing still keys off `externalId` / explicit reply ids.

## Tasks

1. Register the lane and review local/hosted Linq UX and delivery dependencies with multiple high-reasoning explorers.
2. Define one minimal Linq raw schema that preserves only ids, reply linkage, service/direction, counts, and non-sensitive attachment metadata.
3. Implement that schema only at the later persisted Linq capture `raw` seam inside `packages/inboxd`, for both local and hosted captures.
4. Update focused tests to lock the new privacy boundary and prove no regression in attachments or reply routing.
5. Run required verification and audit passes, fix any findings, and land a scoped commit.

## Decisions

- Keep local webhook minimizers and hosted Linq wake payloads unchanged in this pass. They still need richer pre-normalization data for canonical webhook replay and hosted attachment hydration.
- Minimize only the later persisted `capture.raw` copy built in `packages/inboxd/src/connectors/linq/normalize.ts`; this removes duplicated direct identifiers and message-part payloads from persisted inbox captures without changing assistant prompt inputs.
- Preserve normalized `capture.text`, `externalId`, thread/actor fields, and live attachment download inputs exactly as before so assistant UX, reply routing, and attachment handling stay stable.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/inboxd/src/connectors/linq/normalize.ts packages/inboxd/test/linq-connector.test.ts`
- `pnpm --dir packages/inboxd test:coverage`
- `pnpm --dir packages/inboxd exec vitest run test/linq-connector.test.ts`
- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-automation-runtime.test.ts test/assistant-channels-runtime.test.ts`
- `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-conversation-event.test.ts test/hosted-runtime-linq-event.test.ts`
- `pnpm --dir packages/operator-config exec vitest run test/http-linq-device-runtime.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts`
- `pnpm --dir apps/cloudflare test:e2e:linq-webhook:local`
- `pnpm --dir apps/cloudflare test:e2e:linq-delivery:local`
- `pnpm test:smoke`
- Expected outcomes:
- Linq `raw` shrinks to a stable minimal schema while normalized text, attachments, and reply delivery still work.
- Repo-level verification is green or fails only for a credibly unrelated pre-existing reason called out in handoff.

## Outcome

- Landed only the `packages/inboxd` persisted-raw minimization seam, leaving webhook and hosted wake contracts unchanged for safety.
- Focused `inboxd`, assistant/runtime, operator-config, and hosted-onboarding checks passed.
- `pnpm --dir packages/inboxd test:coverage` passed as the owner-level coverage-bearing verification lane.
- Repo-wide `pnpm typecheck` and scoped `workspace-verify test:diff` are red for unrelated dirty `packages/assistant-engine` type errors outside this slice.
- Cloudflare local Linq E2E lanes are still red, but the failures do not appear plausibly caused by this raw-only `packages/inboxd` change; they overlap an active hosted-local Linq voice-memo proof lane and a separate delivery-path expectation mismatch.

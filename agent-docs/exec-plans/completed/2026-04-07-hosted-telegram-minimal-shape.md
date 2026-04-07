# Hosted Telegram Minimal Shape

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Hard-cut the hosted Telegram path to the smallest long-term architecture that still supports receiving messages, replying in-thread, and fetching all attachment types.

## Success criteria

- Hosted web stores only Telegram routing/receipt metadata plus staged payload refs, never raw Telegram content.
- The hosted execution Telegram event contract carries a narrow, explicit message payload rather than a minimized raw webhook update blob.
- Hosted runtime ingestion writes durable inbox captures with no Telegram names, usernames, titles, contact details, coordinates, venue text, or poll text/options.
- Non-text Telegram content is represented durably only as coarse placeholders, while attachment support remains intact.
- Telegram auto-reply reply mechanics continue to work from minimal durable metadata only.
- Focused tests cover contract parsing, payload confidentiality, hosted ingestion, and Telegram auto-reply metadata behavior.

## Scope

- In scope:
- `apps/web/src/lib/hosted-onboarding/{telegram,webhook-provider-telegram,webhook-event-snapshots}.ts`
- `packages/hosted-execution/**`
- `packages/assistant-runtime/**`
- `packages/inboxd/src/connectors/telegram/normalize.ts`
- `packages/assistant-engine/src/assistant/automation/**`
- `apps/web/test/**`
- `apps/cloudflare/test/**`
- `packages/hosted-execution/test/**`
- `packages/inboxd/test/**`
- `ARCHITECTURE.md`
- This active plan
- Out of scope:
- Broad local Telegram poll-connector redesign outside the hosted execution path
- Telegram outbound channel behavior beyond using the existing thread target and reply-to message id
- Unrelated hosted contact-privacy key rotation work already in flight

## Constraints

- Technical constraints:
- Keep the long-term architecture explicit and simple: one hosted Telegram payload contract with only routing, text/placeholder, and attachment-fetch metadata.
- Preserve full attachment support for hosted Telegram ingestion.
- Keep durable Telegram metadata to the minimum required for reply delivery and media-group grouping.
- Product/process constraints:
- Greenfield hard cuts are allowed; do not preserve legacy hosted Telegram payload shapes unless still required by tests during the refactor.
- Preserve unrelated dirty-tree edits and avoid editing `contact-privacy.ts` unless there is no narrower seam.
- Follow the repo high-risk workflow, including direct scenario proof and a required final review audit.

## Risks and mitigations

1. Risk: A minimal payload cut accidentally drops fields required to fetch attachments or reply in-thread.
   Mitigation: keep explicit message/thread/reply metadata and all attachment file ids plus tested hydration paths.
2. Risk: Telegram-specific prompt/reply features still depend on copied raw payload details.
   Mitigation: replace raw reply-context dependencies with a tiny metadata seam and drop non-essential context instead of translating it forward.
3. Risk: The contract remains named or shaped like a raw webhook blob even after the hard cut.
   Mitigation: introduce a dedicated hosted Telegram message payload type and parser in `packages/hosted-execution`.

## Tasks

1. Add the active coordination row and keep this plan updated.
2. Introduce the narrow hosted Telegram message payload contract plus parser/builder coverage.
3. Update hosted-web Telegram webhook planning to build the new payload shape directly instead of minimizing a raw update.
4. Update hosted runtime Telegram ingestion to normalize from the new minimal payload while preserving attachment hydration.
5. Remove durable Telegram reply-context dependence on copied raw payloads and keep only the tiny metadata needed for reply delivery/grouping.
6. Update tests, architecture docs, verification, direct scenario proof, audit review, and scoped commit.

## Decisions

- Hosted Telegram durable storage will keep coarse placeholders for contact/location/venue/poll messages rather than preserving structured content.
- Durable Telegram actor display names, usernames, chat titles, contact payloads, coordinates, venue payloads, poll payloads, and raw nested reply copies are all removed.
- Hosted Telegram reply behavior will rely only on thread target plus message id, and media-group grouping will rely only on `mediaGroupId`.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:coverage`
- focused Vitest runs for hosted Telegram dispatch/runtime/auto-reply coverage if iteration needs narrower proof first
- Expected outcomes:
- The hosted Telegram path compiles against the narrow contract, reference payload confidentiality still holds, hosted runtime ingestion preserves reply and attachment behavior, and no Telegram PII survives in durable hosted payloads or durable capture metadata.
- Actual outcomes:
- Passed:
- `packages/hosted-execution`: `pnpm typecheck`
- `packages/inboxd`: `pnpm typecheck`
- `packages/inboxd`: `pnpm exec vitest run test/telegram-connector.test.ts --config vitest.config.ts --no-coverage`
- `apps/web`: `pnpm --dir ../.. exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-execution-contract-parity.test.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts apps/web/test/hosted-onboarding-webhook-receipt-transitions.test.ts apps/web/test/hosted-onboarding/webhook-receipt-privacy.test.ts`
- `apps/cloudflare`: `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-queue-confidentiality.test.ts`
- Direct scenario proof:
- `buildHostedTelegramMessagePayload()` on a contact message produced only `{"messageId":"44","schema":"murph.hosted-telegram-message.v1","text":"[shared contact]","threadId":"123"}`
- Blocked by unrelated pre-existing failures:
- Repo-wide `pnpm typecheck`
- Repo-wide `pnpm test:coverage`
- `apps/cloudflare/test/node-runner.test.ts` focused Telegram tests currently fail in unrelated hosted runtime setup with `Cannot read properties of undefined (reading 'platform')`
Completed: 2026-04-07

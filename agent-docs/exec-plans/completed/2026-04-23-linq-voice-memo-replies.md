# Debug hosted Linq voice memo reply failure

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Restore hosted Murph auto-replies for Linq iMessage voice memos by finding the exact media-ingest failure and fixing it without widening into unrelated Linq onboarding or outbound-delivery work.

## Success criteria

- Hosted Linq `message.received` wakes carrying voice-memo media become usable assistant input instead of stalling before reply generation.
- Focused regression coverage proves the failing voice-memo/media shape stays replyable.
- Required scoped verification passes for the touched owners are green, or any unrelated pre-existing failure is explicitly identified.

## Scope

- In scope:
- Downloaded hosted run/log exports needed to identify the failure.
- The shared Linq webhook parser/minimization seam if the media payload shape is wrong there.
- Hosted web Linq ingress, hosted wake payload assembly, and assistant-runtime media ingestion for the failing voice-memo path.
- Focused tests for the touched owners.
- Out of scope:
- Unrelated Linq onboarding copy/routing flows.
- Generic outbound-reply behavior when non-media Linq messages already work.
- Broad parser/runtime refactors beyond the minimal repair.

## Constraints

- Technical constraints:
- Preserve unrelated dirty-tree work and keep the fix scoped to the hosted Linq voice-memo path.
- Treat hosted messaging payloads, attachment URLs, and logs as sensitive; avoid persisting or echoing raw secrets or personal identifiers.
- Product/process constraints:
- Follow the repo high-risk workflow: plan + ledger, scoped verification, required audit passes, and a scoped commit if code changes land.

## Risks and mitigations

1. Risk: The failure sits in a hosted-only payload/minimization seam and is easy to mask with a local-only fix.
   Mitigation: Trace the exported hosted logs first, then align the fix with the actual hosted ingress and runtime path.

2. Risk: The work overlaps active hosted runtime and assistant lanes in the dirty tree.
   Mitigation: Keep the write scope narrow, avoid unrelated files, and verify diffs carefully before commit.

## Tasks

1. Inspect the downloaded log exports and isolate the exact hosted failure point for Linq voice memos.
2. Trace the corresponding code path across webhook parsing, hosted wake assembly, and assistant-runtime media ingestion.
3. Implement the minimal repair and add focused regression coverage.
4. Run the required verification and completion workflow for the touched owners.

## Decisions

- Treat the regression as a hosted-only media hydration failure after successful Linq webhook ingress, not as an iMessage delivery problem.
- Keep the main recovery logic in `packages/assistant-runtime`'s hosted Linq attachment downloader: extend the voice-memo timeout and, when direct CDN fetch fails, refresh the download URL through the Linq attachment metadata API using `attachmentId`.
- Keep inbox normalization generic by adding an optional `downloadPart(...)` hook that hydrates metadata-only attachments and acts only as a fallback when the direct URL path is missing or fails.
- Harden canonical Linq parsing additively by accepting camelCase media metadata fallbacks alongside the existing snake_case shape.

## Verification

- Commands to run:
- `pnpm vitest packages/assistant-runtime/test/hosted-runtime-linq-event.test.ts packages/messaging-ingress/test/linq-webhook.test.ts packages/inboxd/test/linq-connector.test.ts`
- `pnpm --filter @murphai/messaging-ingress typecheck`
- `pnpm --filter @murphai/assistant-runtime typecheck`
- `pnpm --filter @murphai/inboxd typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/inboxd/src/connectors/linq/normalize.ts packages/inboxd/test/linq-connector.test.ts packages/messaging-ingress/src/linq-webhook.ts packages/messaging-ingress/test/linq-webhook.test.ts packages/assistant-runtime/src/hosted-runtime/events/linq.ts packages/assistant-runtime/test/hosted-runtime-linq-event.test.ts`
- Outcomes so far:
- Focused Linq Vitest lane passes (`3` files, `42` tests).
- `@murphai/messaging-ingress` typecheck passes.
- `@murphai/assistant-runtime` typecheck passes.
- `@murphai/inboxd` typecheck passes.
- The truthful `test:diff` lane still fails in unrelated `packages/assistant-engine` tests covering provider execution and wrapper exports, after the touched Linq owners and their dependents finish typecheck successfully.
Completed: 2026-04-23

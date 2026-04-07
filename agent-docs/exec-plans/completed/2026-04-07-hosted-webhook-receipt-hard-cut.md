# Hard-cut hosted webhook receipt persistence to typed workflow state

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Replace blob-centered hosted webhook receipt persistence with typed SQL workflow state plus typed retry rows so hosted receipts stop durably storing generic `eventPayload`, `response`, and payload-bearing side-effect JSON.

## Success criteria

- `HostedWebhookReceipt` no longer uses `payloadJson` for mutable workflow state.
- Receipt claim/update CAS uses an explicit integer `version` rather than whole-blob equality.
- Receipt retry state lives in typed SQL columns and typed side-effect rows only.
- Hosted onboarding webhook routes no longer persist response JSON or generic event payload JSON on receipts.
- Duplicate Linq control-plane webhook responses are derived from durable queued-event state instead of receipt response JSON.
- Focused hosted receipt/onboarding tests pass, required hosted-web verification commands run, and docs reflect the new ownership model.

## Scope

- In scope:
- `apps/web/prisma/schema.prisma` and the greenfield init migration for `HostedWebhookReceipt`
- hosted webhook receipt runtime modules under `apps/web/src/lib/hosted-onboarding/webhook-*`
- `apps/web/src/lib/linq/control-plane.ts` duplicate-response behavior
- focused hosted-web tests covering receipt retries, onboarding dispatches, privacy, and Linq control-plane duplicates
- durable docs describing hosted receipt storage/idempotency
- Out of scope:
- changing Cloudflare execution outbox ownership
- changing non-receipt hosted onboarding domains such as member lifecycle, billing, or device-sync
- adding compatibility readers or live-data migrations beyond the greenfield schema hard cut

## Constraints

- Technical constraints:
- Preserve unrelated dirty-tree edits in overlapping hosted files.
- Keep dispatch side effects reference-only and continue treating the outbox row as the durable handoff owner.
- Any persisted receipt state must stay compact, typed, and queryable without a generic JSON sink.
- Product/process constraints:
- Treat this as a high-risk persistence/privacy refactor and run the required hosted-web verification plus direct scenario proof.
- Use repo completion-workflow audit passes before final handoff.

## Risks and mitigations

1. Risk: removing blob-stored response state can break duplicate webhook behavior for existing callers.
   Mitigation: trace every duplicate-response caller first and derive any needed duplicate response from typed durable rows instead of keeping response JSON.
2. Risk: receipt and side-effect CAS updates can drift if receipt row updates and side-effect row updates are not applied atomically.
   Mitigation: keep receipt-row versioning and side-effect sync inside the same transaction for every state transition.
3. Risk: terminal compaction can accidentally discard the narrow data still required for delivery-uncertain repair.
   Mitigation: keep only explicit `sent_unconfirmed` repair state; delete or avoid persisting all other terminal payload-bearing state.

## Tasks

1. Replace the receipt schema with typed workflow columns plus a typed side-effect table and update the greenfield init migration.
2. Refactor hosted webhook receipt runtime/store logic to use receipt version CAS, typed side-effect row sync, and no persisted response/event payload JSON.
3. Derive Linq control-plane duplicate responses from queued-event state instead of receipt response blobs.
4. Update focused hosted-web tests and durable docs for the new receipt architecture.
5. Run required verification and scenario proof, then complete the simplify and final review audit passes.

## Decisions

- Greenfield hard cut: update the init migration and current Prisma schema directly instead of adding a compatibility migration on top of blob-based receipt storage.
- Receipt completion should leave only narrow receipt metadata; sent side effects should not remain durably stored on the receipt lane.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- focused `vitest` files for hosted webhook receipt/onboarding/Linq control-plane paths during iteration
- Expected outcomes:
- Hosted-web receipt and onboarding tests pass against the typed receipt schema/runtime.
- Durable docs and architecture text match the new receipt ownership and retention model.
Completed: 2026-04-07

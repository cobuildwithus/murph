# Hosted progress delivery uses hosted channel bridge

Status: completed
Created: 2026-05-29
Updated: 2026-05-29

## Goal

- Hosted iMessage/Linq assistant turns can call `murph.send_progress_update` and have that progress message delivered through the same hosted channel bridge/credential path as normal hosted sends, without moving progress into the durable final-reply outbox lifecycle.

## Success criteria

- Hosted execution context carries explicit Linq progress delivery dependencies for progress sends.
- `deliverAssistantProgressUpdate` accepts and uses those dependencies while preserving ephemeral direct-send semantics.
- Regression coverage proves hosted progress delivery uses injected hosted bridge dependencies and hosted runtime builds them.
- Typecheck and truthful focused tests pass.

## Scope

- In scope:
  - `packages/assistant-engine` progress delivery/dependency threading.
  - `packages/assistant-runtime` hosted channel dependency construction.
  - Focused tests for hosted progress dependency routing.
- Out of scope:
  - Changing final assistant reply outbox semantics.
  - Adding a model-facing final response tool.
  - Changing unrelated device-sync/Junction/Murph Age work already dirty in the tree.

## Constraints

- Technical constraints:
  - Progress updates are best-effort, capped, deduped, and immediate.
  - Hosted provider credentials stay Worker-owned; the child runtime must use provider fetch/write-fence injection instead of raw provider secrets.
  - Keep package boundaries through public assistant-engine entrypoints.
- Product/process constraints:
  - Preserve privacy guardrails; no raw identifiers, tokens, prompts, or message bodies in logs/tests.
  - Use the repo plan-bearing commit path and avoid unrelated dirty files.

## Risks and mitigations

1. Risk: Accidentally routing progress through queue-only final delivery makes progress stale or durable.
   Mitigation: Keep `deliverAssistantProgressUpdate` on `sendAssistantOutboxPayload` and inject only channel dependencies.
2. Risk: Hosted dependency construction duplicates final outbox delivery logic.
   Mitigation: Reuse the same hosted provider effect helpers/env builders behind one small dependency factory.
3. Risk: Direct adapter fallback still runs in hosted if dependencies are missing.
   Mitigation: Pass delivery dependencies from hosted runtime and cover the path in tests.

## Tasks

1. Done: Add assistant-engine hosted progress delivery dependency type/normalization.
2. Done: Pass hosted Linq progress delivery dependencies into assistant progress delivery.
3. Done: Add hosted runtime dependency factory using hosted provider effects.
4. Done: Add focused and hosted-local Linq regression tests.
5. Done: Run verification and required completion audits.

## Decisions

- Keep progress delivery ephemeral rather than queue-only/durable.
- Make hosted progress use the same provider bridge/auth path as final hosted sends by injecting channel delivery dependencies.
- Limit hosted progress delivery dependencies to Linq rather than exposing the broader final outbox channel dependency surface.

## Verification

- Passed:
  - `pnpm --dir packages/assistant-engine typecheck`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm --dir packages/assistant-engine exec vitest run test/assistant-service-runtime.test.ts test/assistant-local-service-runtime.test.ts test/assistant-turn-progress.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-channel-activity.test.ts test/hosted-runtime-workspace-assistant-phase.test.ts test/hosted-runtime-workspace-assistant-phase-diagnostics.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts --no-coverage -t "delivers a model-authored progress update through the hosted Linq bridge"`
  - `pnpm typecheck`
  - `pnpm test:diff apps/cloudflare/test/helpers/hosted-local-linq-support.ts apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts packages/assistant-engine/src/assistant/delivery-service.ts packages/assistant-engine/src/assistant/execution-context.ts packages/assistant-engine/src/assistant/local-service.ts packages/assistant-engine/src/assistant/service-contracts.ts packages/assistant-engine/src/assistant/service.ts packages/assistant-engine/test/assistant-local-service-runtime.test.ts packages/assistant-engine/test/assistant-service-runtime.test.ts packages/assistant-runtime/src/hosted-runtime/callbacks.ts packages/assistant-runtime/src/hosted-runtime/codex-e2e-app-server-stub.ts packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/test/hosted-runtime-channel-activity.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase-diagnostics.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`

Note: the canonical hosted-local harness attempted a runner base rebuild because of unrelated runner-base image work in the checkout. The targeted E2E was run directly with the prepared bundle and cached base image skip flags to exercise the hosted Linq progress path without rebuilding the base image.
Completed: 2026-05-29

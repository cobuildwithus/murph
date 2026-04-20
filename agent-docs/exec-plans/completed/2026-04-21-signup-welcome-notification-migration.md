# Migrate signup welcome onto generic assistant notification flow

Status: completed
Created: 2026-04-21
Updated: 2026-04-21

## Goal

- Land the returned ChatGPT patch that removes the bespoke hosted signup first-contact welcome path.
- Replace `member.activated.firstContact` delivery behavior with a generic `assistant.notification.requested` ingress event.
- Keep the migration scoped to the artifact intent while preserving unrelated dirty-tree work.

## Success criteria

- Hosted activation appends a bootstrap-only `member.activated` wake plus a generic `assistant.notification.requested` wake for the signup welcome.
- Assistant runtime routes the welcome through the generic notification-turn path instead of `queueAssistantFirstContactWelcome(...)`.
- Linq participant-to-thread materialization moves into the generic channel-delivery path via delivery-source support.
- Welcome-specific assistant delivery seams and hosted-execution contract shapes (`firstContact`, `linq-materialize-home-thread`) are removed from the touched owners.
- Focused regression proof covers the new notification path and the same-session Linq materialization behavior.

## Scope

- `apps/web/src/lib/hosted-onboarding/{linq-home-routing,member-activation,messaging-state}.ts`
- `apps/web/test/hosted-onboarding-{linq-home-routing,member-activation}.test.ts`
- `packages/assistant-engine/src/assistant/**`
- `packages/assistant-engine/test/**`
- `packages/assistant-runtime/src/hosted-runtime/{events,execution,models}.ts`
- `packages/assistant-runtime/test/**`
- `packages/contracts/src/{assistant,index}.ts`
- `packages/gateway-core/src/reply-routes.ts`
- `packages/hosted-execution/src/{builders,contracts,parsers}.ts`
- `packages/hosted-execution/test/**`
- `packages/operator-config/src/assistant-cli-contracts.ts`

## Constraints

- Keep changes aligned with the downloaded artifact; do not widen into unrelated hosted onboarding or Cloudflare runtime refactors.
- Preserve existing dirty-tree edits, especially the already-dirty `packages/assistant-engine/test/assistant-product-small-seams.test.ts` file.
- Do not reintroduce welcome-specific runtime branches, worker logic, or delivery metadata after the migration.

## Risks and mitigations

1. Risk: Removing `firstContact` could break hosted activation delivery or stale queued wakes.
   Mitigation: Carry the artifact’s parser/runtime updates together and extend tests around the new generic wake path.

2. Risk: Generic Linq participant delivery could fail to materialize the same session onto the returned thread id.
   Mitigation: Keep the patch’s delivery-source and target-kind propagation intact and add focused same-session assertions.

3. Risk: Dirty-tree drift in assistant-engine tests could make the artifact patch misapply.
   Mitigation: Apply the artifact carefully, then manually merge only the conflicting hunks with a narrow readback before verification.

## Tasks

1. Register the migration scope in the active plan and coordination ledger.
2. Apply the returned patch and manually resolve the assistant-engine drift points.
3. Update directly coupled regression tests without overwriting unrelated dirty edits.
4. Run scoped verification for the touched owners and record unrelated blockers separately.
5. Close out with the repo-required handoff and commit path if verification and worktree state permit it.

## Verification

- planned: `pnpm typecheck`
- planned: `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding/linq-home-routing.ts apps/web/src/lib/hosted-onboarding/member-activation.ts apps/web/src/lib/hosted-onboarding/messaging-state.ts apps/web/test/hosted-onboarding-linq-home-routing.test.ts apps/web/test/hosted-onboarding-member-activation.test.ts packages/assistant-engine/src/assistant/channels/descriptors.ts packages/assistant-engine/src/assistant/channels/helpers.ts packages/assistant-engine/src/assistant/channels/types.ts packages/assistant-engine/src/assistant/delivery-service.ts packages/assistant-engine/src/assistant/first-contact-welcome-delivery.ts packages/assistant-engine/src/assistant/first-contact-welcome-turn-metadata.ts packages/assistant-engine/src/assistant/first-contact-welcome.ts packages/assistant-engine/src/assistant/local-service.ts packages/assistant-engine/src/assistant/notification-turn.ts packages/assistant-engine/src/assistant/outbox.ts packages/assistant-engine/src/assistant/outbox/intents.ts packages/assistant-engine/src/assistant/service-contracts.ts packages/assistant-engine/src/assistant/service.ts packages/assistant-engine/src/assistant/session-resolution.ts packages/assistant-engine/src/outbound-channel.ts packages/assistant-engine/test/assistant-outbox-runtime.test.ts packages/assistant-engine/test/assistant-product-small-seams.test.ts packages/assistant-engine/test/assistant-service-runtime.test.ts packages/assistant-runtime/src/hosted-runtime/events.ts packages/assistant-runtime/src/hosted-runtime/execution.ts packages/assistant-runtime/src/hosted-runtime/models.ts packages/assistant-runtime/test/hosted-runtime-events.test.ts packages/assistant-runtime/test/hosted-runtime-events-coverage.test.ts packages/assistant-runtime/test/hosted-runtime-parsers.test.ts packages/contracts/src/assistant.ts packages/contracts/src/index.ts packages/gateway-core/src/reply-routes.ts packages/hosted-execution/src/builders.ts packages/hosted-execution/src/contracts.ts packages/hosted-execution/src/parsers.ts packages/hosted-execution/test/parsers.test.ts packages/operator-config/src/assistant-cli-contracts.ts`
- planned: `git diff --check`
Completed: 2026-04-21
